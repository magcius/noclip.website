import { DatabaseKey, GOOL, LevelData, MeshFlags, ModelInfo, ModelType, ObjectPlacement, SeriesDatabase, decodeChunkName } from "./bin.js";
import { assert, assertExists, nArray } from "../util.js";
import { clamp, getMatrixTranslation, lerp, MathConstants, normToLength, randomRange, setMatrixTranslation, transformVec3Mat4w1, Vec3One, Vec3Zero } from "../MathHelpers.js";
import { ViewerRenderInput } from "../viewer.js";
import { mat4, ReadonlyVec3, vec3 } from "gl-matrix";
import { RenderParams as RenderParams, ModelData, QuadListData, renderMesh, renderQuadList, WarpTextureRemap, RenderMode, RenderGlobals, renderSprite } from "./render.js";
import { AABB } from "../Geometry.js";
import { parseMIPSOpcode, Opcode as MIPS, RegName } from "../PokemonSnap/mips.js";

enum Opcode {
    ADD = 0x00,
    SUB = 0x01,
    MUL = 0x02,
    DIV = 0x03,
    EQ = 0x04,
    LOGICAL_AND = 0x05,
    OR = 0x06,
    AND = 0x07,
    OR_2 = 0x08,
    LT = 0x09,
    LTE = 0x0A,
    GT = 0x0B,
    GTE = 0x0C,
    MOD = 0x0D,
    XOR = 0x0E,
    HAS_BITS = 0x0F,
    RAND = 0x10,
    STORE = 0x11,
    STORE_NOT = 0x12,
    OSCILLATE = 0x13,
    STORE_PTR = 0x14,
    SHIFT = 0x15,
    TWO_VALUES = 0x16,
    STORE_COMPLEMENT = 0x17,
    STORE_SCRIPT_ADDR = 0x18,
    STORE_ABS = 0x19,
    GET_PLAYER_FLAG = 0x1A, // really unsure
    VELOCITY = 0x1B,
    INTERACT_OP = 0x1C,
    EASE = 0x1D,
    FRAME_MOD = 0x1E,
    GET_GLOBAL = 0x1F,
    SET_GLOBAL = 0x20,
    SUB_ANGLE = 0x21,
    STEP_TO = 0x22,
    GET_LIGHTING = 0x23,
    SET_LIGHTING = 0x24,
    TURN_TO = 0x25,
    TWO_PTRS = 0x26,
    STORE_GEO = 0x27,
    DB_VALUE = 0x28,
    STORE_DB = 0x29,
    INDEX = 0x2A,
    STORE_SIN = 0x2B,
    STORE_COS = 0x2C,
    ATAN2 = 0x2D,
    // camera transform on vec? = 0x2E,
    NOP = 0x2F,
    OBJ_NOP = 0x30,
    RETURN = 0x31,
    JMP = 0x32,
    BNZ = 0x33,
    BEZ = 0x34,
    SET_STATE = 0x35,
    SET_STATE_TRUE = 0x36,
    SET_STATE_FALSE = 0x37,
    SET_GEO = 0x38,
    SET_FRAME = 0x39,
    VECTOR_OP = 0x3A,
    JAL = 0x3B,
    SEND_SIGNAL = 0x3C,
    RECEIVE_SIGNAL_A = 0x3D,
    RECEIVE_SIGNAL_B = 0x3E,
    SPAWN_CHILD = 0x3F,
    MANAGE_DATA = 0x40,
    PLAY_SOUND_A = 0x41, // don't know details
    PLAY_SOUND_B = 0x42,
    //  = 0x42,
    //  = 0x43,
    COLLIDE_ALL = 0x44,
    COLLIDE_ONE = 0x45,
    SPAWN_CHILD_2 = 0x46,
    JALR = 0x47,
    //  = 0x48,
    EXEC = 0x49,
    LOAD_SPECIAL_TEXTURE = 0x4A,
    FREE_SPECIAL_TEXTURE = 0x4B,
    DECOMPRESS_SPECIAL_TEXTURE = 0x4C,
    USE_SPECIAL_TEXTURE = 0x4D,
    //  = 0x4E,
    GET_WATER = 0x4F,
    STORE_SPHERICAL = 0x50,
    DRAW_LINE = 0x51,
}

enum Source {
    SELF = 0x00,
    PARENT = 0x01,
    NEXT = 0x02,
    CHILD = 0x03,
    SPAWNER = 0x04,
    PLAYER = 0x05,
    COLLIDER = 0x06,
    SIGNALLER = 0x07,
    POS_X = 0x08,
    POS_Y = 0x09,
    POS_Z = 0x0A,
    PITCH = 0x0B,
    YAW = 0x0C,
    ROLL = 0x0D,
    SCALE_X = 0x0E,
    SCALE_Y = 0x0F,
    SCALE_Z = 0x10,
    VEL_X = 0x11,
    VEL_Y = 0x12,
    VEL_Z = 0x13,
    YAW_SPEED = 0x14,
    TARGET_YAW = 0x15,
    TARGET_PITCH = 0x16, VEL_LIMIT = 0x16,
    TEMP_VEC_X = 0x17,
    TEMP_VEC_Y = 0x18,
    TEMP_VEC_Z = 0x19,
    COLLISION = 0x1A,
    FLAGS = 0x1B,
    INTERACT = 0x1C,
    OBJECT_ID = 0x1D,
    LOOKUP_INDEX = 0x1E,
    STACK = 0x1F,
    SCRIPT_PTR = 0x20,
    FRAME_PTR = 0x21,
    PRE_RUN = 0x22,
    ON_SIGNAL = 0x23,
    RESUME_SCRIPT = 0x24,
    TEMP_A = 0x25,
    TEMP_B = 0x26,
    LAST_UPDATE = 0x27,
    STATE_START = 0x28,
    UV_FRAME = 0x29,
    GEOMETRY = 0x2A,
    ANIM_FRAME = 0x2B,
    DATABASE = 0x2C,
    PATH_T = 0x2D,
    PATH_LEN = 0x2E,
    REF_HEIGHT = 0X2F,
    MOTION = 0x30,
    SPEED = 0x31,
    LIGHTING_MODE = 0x32,
    LIGHTING_TIMER = 0x33,
    LAST_GROUND_HIT = 0x34,
    IMPACT_VEL = 0x35,
    DEPTH_OFFSET = 0x36,
    SIGNAL_VALUE = 0x37,
    GEO_FORMAT = 0x38,
    PITCH_SPEED = 0x39,
    RADIUS_MODIFIER = 0x3A,
    SNAP_THRESHOLD = 0x3D,
    PAIR_VEC_A_X = 0x44,
    PAIR_VEC_A_Y = 0x45,
    PAIR_VEC_A_Z = 0x46,
    PAIR_VEC_B_X = 0x47,
    PAIR_VEC_B_Y = 0x48,
    PAIR_VEC_B_Z = 0x49,
    MISC_COUNTER_X = 0x4B,
    MISC_COUNTER_Y = 0x4C,
    MISC_COUNTER_Z = 0x4D,


    // earlier lighting data, all shorts
    LIGHTING_INFO = 0x200,
    // not actually part of the object struct in game
    REF_FLAGS = 0x300,
    // bad hack to get around using frame as a vector
    FRAME_VECTOR = 0x400,
}

type NonScriptSource = Exclude<Source, Source.SCRIPT_PTR>

type VecSource = Source.POS_X | Source.PITCH | Source.YAW_SPEED | Source.VEL_X | Source.SCALE_X | Source.TEMP_VEC_X | Source.PAIR_VEC_A_X | Source.PAIR_VEC_B_X | Source.MISC_COUNTER_X | 0;

enum GlobalVariable {
    LEVEL_ID = 0x00,
    STATUS_FLAGS_A = 0x04,
    DEATHS_IN_LEVEL = 0x05,
    WUMPA_FRUIT = 0x06,
    ONE_UP = 0x07,
    STATUS_FLAGS_B = 0x09,
    PAUSE_MENU = 0x0C,
    CAMERA_HEADING = 0x0F,
    QUESTION_CRATE = 0x1D,
    CAMERA_POS_X = 0x25,
    CAMERA_POS_Y = 0x26,
    CAMERA_POS_Z = 0x27,
    CAMERA_ROT_X = 0x28,
    CAMERA_ROT_Y = 0x29,
    CAMERA_ROT_Z = 0x2A,
    FRAME_TIME = 0x2B,

    FRAME_COUNT = 0x4F,
    FADE_TIMER = 0x6A,
    FADE_DELTA = 0x6B,
    PLAYER_SHADOW = 0x73,
    LEVEL_FLAGS = 0x77,
    BOSS_SHADOW = 0xBA,

    EARLY_CRYSTAL_FLAGS = 0x8D,
    LATE_CRYSTAL_FLAGS = 0x8E,

    DEATHS_IN_SEGMENT = 0x92,
    AREA_UNLOCKS = 0x96,
    TIME_TRIAL = 0xAD,
}

export function initGlobals(id: number, completed: boolean, globals: number[]): void {
    globals[GlobalVariable.STATUS_FLAGS_A] = 0xC01FFFF;
    globals[GlobalVariable.STATUS_FLAGS_B] = 0xC01FFFF;
    if (completed) {
        // globals[GlobalVariable.EARLY_CRYSTAL_FLAGS] = 0x1F;
        globals[GlobalVariable.EARLY_CRYSTAL_FLAGS] = 0xFFFFFFFF;
        globals[GlobalVariable.LATE_CRYSTAL_FLAGS] = 0xFFFFFFFF;
        globals[GlobalVariable.AREA_UNLOCKS] = 0xFFFFFF;
    }
    globals[GlobalVariable.LEVEL_ID] = id << 8;
    globals[GlobalVariable.TIME_TRIAL] = 0;
    // globals[GlobalVariable.DEATHS_IN_LEVEL] = 1;
    // globals[GlobalVariable.DEATHS_IN_SEGMENT] = 1 << 8;
    globals[GlobalVariable.FADE_TIMER] = 0;
    globals[GlobalVariable.FADE_DELTA] = 0x20;

    // TODO: figure out which database we should read from
    if (id === 6) // tiny uses this to coordinate the opening animation, we'll just start it all at once
        globals[GlobalVariable.LEVEL_FLAGS] = 0x600;
    globals[0x12] = 7;
    globals[0x5F] = 0x2A;
    globals[0xA] = 0x100;
    globals[0x61] = buildPointer(PointerBase.OBJECT, 0); // not sure what this is or how it gets set
}

export function updateState(game: GameState, viewerInput: ViewerRenderInput): void {
    game.frame = viewerInput.time * 30 / 1000;
    game.t = viewerInput.time;

    getMatrixTranslation(game.player.pos, viewerInput.camera.worldMatrix);
    game.globals[GlobalVariable.CAMERA_POS_X] = game.player.get(Source.POS_X);
    game.globals[GlobalVariable.CAMERA_POS_Y] = game.player.get(Source.POS_Y);
    game.globals[GlobalVariable.CAMERA_POS_Z] = game.player.get(Source.POS_Z);
    const id = game.globals[GlobalVariable.LEVEL_ID] >>> 8;
    if (id === 0xE || id === 0x1C) // side scrolling water levels
        game.player.pos[2] = 675;
    else if (id === 6) {
        // tiny will follow us off the map
        game.player.pos[0] = clamp(game.player.pos[0], -150, 150);
        game.player.pos[2] = clamp(game.player.pos[2], -150, 125);
    }

    // impacts hub warp loading?
    // game.player.set(Source.MOTION, 0x2000);

    game.globals[GlobalVariable.CAMERA_ROT_X] = 0;
    game.globals[GlobalVariable.CAMERA_ROT_Y] = atan2(viewerInput.camera.worldMatrix[8], viewerInput.camera.worldMatrix[10]);
    game.globals[GlobalVariable.CAMERA_ROT_Z] = 0;

    if (game.globals[GlobalVariable.FADE_TIMER] < -1) {
        const delta = game.globals[GlobalVariable.FADE_DELTA] * (30 * viewerInput.deltaTime / 1000);
        game.globals[GlobalVariable.FADE_TIMER] = Math.min(-1, game.globals[GlobalVariable.FADE_TIMER] + delta);
    }
}

interface IndirectVecVar {
    base: Source;
    source: VecSource;
}

enum FrameMirrorOp {
    POS = 0,
    NEG = 1,
    FLIP = 2,
    NONE = 3,
}

type Argument = number | null;

interface ArgHandler<S, T> {
    const: (index: number, useAlt: boolean, s: S) => T;
    bool: (value: boolean, s: S) => T;
    variable: (src: Source, s: S) => T;
    frame: (offset: number, s: S) => T;
    indirect: (base: Source, source: Source, s: S) => T;
    literal: (value: number, s: S) => T;
}

const enum ArgType {
    CONST,
    BOOL,
    VAR,
    FRAME,
    INDIRECT,
    LITERAL,
}

// type argType = "const" | "bool" | "var" | "frame" | "indirect" | "literal";

class ArgTyper implements ArgHandler<void, ArgType> {
    const(index: number, useAlt: boolean): ArgType {
        return ArgType.CONST;
    }
    bool(value: boolean): ArgType {
        return ArgType.BOOL;
    }
    variable(src: Source): ArgType {
        return ArgType.VAR;
    }
    frame(offset: number): ArgType {
        return ArgType.FRAME;
    }
    indirect(base: Source, source: Source): ArgType {
        return ArgType.INDIRECT;
    }
    literal(value: number): ArgType {
        return ArgType.LITERAL;
    }
}

const argTyper = new ArgTyper();

function getType(arg: Argument): ArgType {
    return parseArgument(arg, argTyper, null);
}

class ArgPrinter implements ArgHandler<DataView, string> {
    const(index: number, useAlt: boolean, view: DataView): string {
        let val = view.getInt32(index * 4, true);
        if (val < -0x10000)
            val = val >>> 0;
        return `${useAlt ? "alt" : "const"}[${index}]=${val.toString(16)}`;
    }
    bool(value: boolean): string {
        return value ? "true" : "false";
    }
    variable(src: Source): string {
        return varString(src);
    }
    frame(offset: number): string {
        if (offset >= 0)
            return `frame[${offset}]`;
        else
            return `arg[${-offset}]`;
    }
    indirect(base: Source, source: Source): string {
        return `${varString(base)}[${varString(source)}]`
    }
    literal(value: number): string {
        return value.toString(16);
    }
}

class DecodedArgPrinter extends ArgPrinter {
    override const(index: number, useAlt: boolean, view: DataView): string {
        let val = view.getInt32(index * 4, true);
        if (val < -0x10000)
            val = val >>> 0;
        return `${useAlt ? "alt" : "const"}[${index}]=${decodeChunkName(val)}`;
    }
}

class ArgEvaluator implements ArgHandler<void, number> {
    private obj: CrashObject;
    private game: GameState;

    public eval(arg: Argument, obj: CrashObject, game: GameState): number {
        this.obj = obj;
        this.game = game;
        return parseArgument(arg, this, undefined);
    }

    public const(index: number, useAlt: boolean): number {
        const view = useAlt ? this.obj.stateBehavior.constView : this.obj.varBehavior.constView;
        return view.getInt32(index * 4, true);
    }
    public bool(value: boolean): number {
        return bool(value);
    }
    public variable(src: Source): number {
        return this.obj.get(src);
    }
    public frame(offset: number): number {
        return this.obj.getRelFrame(offset);
    }
    public indirect(base: Source, source: Source): number {
        return assertExists(this.obj.getObj(base, this.game)).get(source);
    }
    public literal(value: number): number {
        return value;
    }
}

const argEvaluator = new ArgEvaluator();

class ArgStorer implements ArgHandler<number, void> {
    private obj: CrashObject;
    private game: GameState;

    public store(dest: Argument, value: number, obj: CrashObject, game: GameState): void {
        this.obj = obj;
        this.game = game;
        return parseArgument(dest, this, value);
    }

    public const(index: number, useAlt: boolean): void {
        throw "store to const"
    }
    public bool(value: boolean): void {
        throw "store to bool"
    }
    public variable(src: Source, val: number): void {
        assert(src !== Source.SCRIPT_PTR)
        this.obj.set(src, val);
    }
    public frame(offset: number, value: number): void {
        this.obj.setRelFrame(offset, value);
    }
    public indirect(base: Source, source: Source, value: number): void {
        assert(source !== Source.SCRIPT_PTR)
        assertExists(this.obj.getObj(base, this.game)).set(source, value);
    }
    public literal(value: number): number {
        // literals are valid, as the game passes a pointer to scratch memory,
        // but can be ignored for our purposes
        throw "store to literal"
    }
}
const argStorer = new ArgStorer();

const indVec: IndirectVecVar = {
    base: Source.SELF,
    source: Source.POS_X,
}
class ArgAsVec implements ArgHandler<void, IndirectVecVar | null | undefined > {
    public const(index: number, useAlt: boolean): undefined {
        return undefined;
    }
    public bool(value: boolean): null | undefined {
        return value ? undefined : null;
    }
    public variable(src: Source): IndirectVecVar | undefined {
        if (!isVec(src)) {
            return undefined
        }
        indVec.base = Source.SELF;
        indVec.source = src;
        return indVec;
    }
    public frame(offset: number): IndirectVecVar {
        assert(offset >= 0 || offset <= -3)
        indVec.base = Source.FRAME_VECTOR;
        indVec.source = offset;
        return indVec;
    }
    public indirect(base: Source, src: Source): IndirectVecVar | undefined {
        if (!isVec(src)) {
            return undefined
        }
        indVec.base = base;
        indVec.source = src;
        return indVec;
    }
    public literal(value: number): undefined {
        return undefined;
    }
}
const argToVecConverter = new ArgAsVec();

function asVec(arg: Argument): IndirectVecVar | null | undefined {
    return parseArgument<void, IndirectVecVar | null | undefined>(arg, argToVecConverter, undefined);
}

const enum PointerBase {
    NONE,
    MEMBER,
    PARAMETER,
    FRAME,
    GEOMETRY,
    SCRIPT,
    OBJECT,
    CONSTANTS,
    ALT_CONSTANTS,
    BEHAVIOR,
    RECEIVER,
    MISC,
}
interface Pointer {
    base: PointerBase;
    offset: number;
}

const scratchPointer = {base: PointerBase.NONE, offset: 0}

function parsePointer(val: number): Pointer {
    scratchPointer.base = val >>> 0x1C;
    scratchPointer.offset = (val & 0xFFFFFFF) >>> 2;
    return scratchPointer;
}

function buildPointer(base: PointerBase, offset: number): number {
    return (base << 0x1C) | ( offset << 2);
}

function buildScriptPointer(behavior: GOOL, offset: number): number {
    assertExists(behavior)
    return buildPointer(PointerBase.SCRIPT, (behavior.lookupIndex << 0x10) | offset)
}

class PointerBuilder implements ArgHandler<void, number > {
    public const(index: number, useAlt: boolean): number {
        return buildPointer(PointerBase.CONSTANTS, index);
    }
    public bool(value: boolean): number {
        throw "pointer to bool";
    }
    public variable(src: Source): number {
        assert(src !== Source.STACK)
        return buildPointer(PointerBase.MEMBER, src);
    }
    public frame(offset: number): number {
        if (offset >= 0)
            return buildPointer(PointerBase.FRAME, offset);
        else
            return buildPointer(PointerBase.PARAMETER, -offset);
    }
    public indirect(base: Source, src: Source): number {
        throw "pointer to indirect"
    }
    public literal(value: number): number {
        throw "pointer to literal"
    }
}
const argPointerBuilder = new PointerBuilder();

function buildPointerFromArg(arg: Argument): number {
    return parseArgument(arg, argPointerBuilder, undefined);
}

function isVecOrNull(arg: number, src?: Source): boolean {
    const v = asVec(arg);
    if (v === undefined)
        return false
    if (v === null)
        return true;
    if (src !== undefined)
        return v.source === src;
    return isVec(v.source);
}

interface InstructionHandler<T> {
    basic: (op: Opcode) => T;
    binary: (op: Opcode, left: Argument, right: Argument) => T;
    optional: (op: Opcode, optional: Argument, fixed: Argument) => T;
    store: (op: Opcode, dest: Argument, arg: Argument) => T;
    storeScript: (dest: NonScriptSource, address: number) => T;
    branch: (op: Opcode, offset: number, stackOffset: number, condition: Source) => T;
    setGeo: (model: number, frame: Argument, duration: number, mirror: FrameMirrorOp) => T;
    setState: (op: Opcode, state: number, argCount: number, condition: Source) => T;
    spawnChild: (fileIndex: number, id: number, count: number, argCount: number) => T;
    jal: (target: number, argCount: number) => T;
    interact: (op: number, subOp: number, arg: Argument, other: Source) => T;
    interactVec: (op: number, subOp: number, vecBase: Source, vec: VecSource, other: Source) => T;
    vector: (op: number, vec: VecSource, param: Argument, otherBase: Source, otherVec: VecSource) => T;
    signal: (op: Opcode, target: Source, signal: Argument, argCount: number, condition: Source) => T;
    receive: (op: Opcode, arg: Source, srcOp: number, action: number, scriptOffset: number) => T;
    water: (getNormal: boolean) => T;
    lighting: (op: Opcode, base: Source, src: Source, arg: Argument) => T;
    unknown: (op: Opcode, raw: number) => T;
}

const FRAME_SIZE = 2;
const GAME_FRAME_SIZE = 3;

const stackArg = 0xE1F;

function toSimple(value: number): number {
    value |= 0x800
    if (value & 0x400)
        return value
    return (value & ~0x80) | 0x300;
}

function parseArgument<S, T>(value: Argument, handler: ArgHandler<S, T>, param: S): T {
    value = value!; // never actually null
    if ((value & 0x800) === 0)
        return handler.const(value & 0x3FF, (value & 0x400) !== 0, param)
    if (value & 0x400) {
        if (value & 0x200) {
            return handler.variable(value & 0x1FF, param);
        }
        return handler.indirect((value >>> 6) & 0x7, value & 0x3F, param);
    }
    if ((value & 0x200) === 0)
        return handler.literal((value << 0x17) >> 0xF, param);
    if ((value & 0x100) === 0)
        return handler.literal((value << 0x18) >> 0x14, param);
    if ((value & 0x80) === 0) {
        let offset = (value << 0x19) >> 0x19;
        // in-game frame takes up three slots
        if (offset >= GAME_FRAME_SIZE)
            offset -= GAME_FRAME_SIZE;
        else
            assert(offset < 0);
        return handler.frame(offset, param);
    }
    return handler.bool((value & 0x10) !== 0, param);
}

function makeLiteral8(x: number): number {
    return 0x800 | x;
}

function makeVar(src: Source): number {
    return 0xE00 | src
}

function isVec(src: Source): src is VecSource {
    switch (src) {
        case Source.POS_X:
        case Source.PITCH:
        case Source.VEL_X:
        case Source.SCALE_X:
        case Source.TEMP_VEC_X:
        case Source.YAW_SPEED: // used for various angle-related stuff
            return true;
    }
    return false;
}

function parseInstruction<T>(inst: number, handler: InstructionHandler<T>): T {
    const op: Opcode = inst >>> 0x18;
    const upper = (inst >>> 0xC) & 0xFFF;
    const lower = (inst >>> 0x0) & 0xFFF;
    switch (op) {
        case Opcode.SET_FRAME:
            return handler.setGeo(-1, lower, (inst >>> 0x10) & 0x3F, (inst >>> 0x16) & 3);
        case Opcode.SET_GEO:
            return handler.setGeo((inst >>> 5) & 0x7FC, makeLiteral8(inst & 0x7F), (inst >>> 0x10) & 0x3F, (inst >>> 0x16) & 3);
        case Opcode.JMP: case Opcode.BEZ: case Opcode.BNZ:
            return handler.branch(op, (inst << 0x16) >> 0x16, (inst >>> 0xA) & 0xF, (inst >>> 0xE) & 0x3F);
        case Opcode.SET_STATE: case Opcode.SET_STATE_TRUE: case Opcode.SET_STATE_FALSE:
            return handler.setState(op, inst & 0x3FF, (inst >>> 0xA) & 0xF, (inst >>> 0xE) & 0x3F);
        case Opcode.ADD: case Opcode.SUB: case Opcode.MUL: case Opcode.DIV:
        case Opcode.EQ: case Opcode.LOGICAL_AND: case Opcode.OR: case Opcode.AND:
        case Opcode.OR_2: case Opcode.LT: case Opcode.LTE: case Opcode.GT: case Opcode.GTE:
        case Opcode.MOD: case Opcode.XOR: case Opcode.HAS_BITS: case Opcode.RAND: case Opcode.SHIFT:
        case Opcode.VELOCITY: case Opcode.EASE: case Opcode.TWO_VALUES: case Opcode.INDEX:
        case Opcode.GET_GLOBAL: case Opcode.SET_GLOBAL: case Opcode.FRAME_MOD: case Opcode.SUB_ANGLE:
        case Opcode.TWO_PTRS: case Opcode.MANAGE_DATA: case Opcode.PLAY_SOUND_A: case Opcode.PLAY_SOUND_B:
        case Opcode.ATAN2: case Opcode.JALR: case Opcode.INDEX:
        case Opcode.FREE_SPECIAL_TEXTURE: case Opcode.DECOMPRESS_SPECIAL_TEXTURE: case Opcode.USE_SPECIAL_TEXTURE:
            if (op === Opcode.TWO_PTRS) {
                assert(getType(upper) !== ArgType.INDIRECT);
                assert(getType(lower) !== ArgType.INDIRECT);
            }
            const right = op === Opcode.PLAY_SOUND_B ? makeVar(upper & 0x3F) : upper;
            return handler.binary(op, lower, right);
        case Opcode.TURN_TO: case Opcode.STEP_TO: case Opcode.OSCILLATE: {
            return handler.optional(op, upper, lower); // default 0x100
        } break;
        case Opcode.STORE: case Opcode.STORE_NOT: case Opcode.STORE_COMPLEMENT:
        case Opcode.STORE_ABS: case Opcode.STORE_SIN: case Opcode.STORE_COS:
        case Opcode.STORE_PTR: case Opcode.STORE_GEO:
            if (op === Opcode.STORE_PTR)
                assert(getType(upper) !== ArgType.INDIRECT);
            return handler.store(op, toSimple(lower), upper);
        case Opcode.LOAD_SPECIAL_TEXTURE:
            return handler.store(op, stackArg, lower);
        case Opcode.STORE_DB:
            return handler.store(op, lower, upper);
        case Opcode.STORE_SCRIPT_ADDR:
            return handler.storeScript((inst >>> 0x12) & 0x3F, inst & 0x7FFF);
        case Opcode.SPAWN_CHILD: case Opcode.SPAWN_CHILD_2:
            return handler.spawnChild((inst >>> 0xC) & 0xFF, (inst >>> 6) & 0x3F, inst & 0x3F, (inst >>> 0x14) & 0xF);
        case Opcode.GET_WATER:
            assert(isVecOrNull(upper, Source.TEMP_VEC_X) && isVecOrNull(lower, Source.POS_X));
            return handler.water(getType(upper) === ArgType.VAR);
        case Opcode.JAL:
            return handler.jal(inst & 0x7FFF, (inst >>> 0x14) & 0xF);
        case Opcode.INTERACT_OP:
            const mainOp = (inst >>> 0x14) & 0xF;
            let subOp = (inst >>> 0xF) & 0x1F;
            let other = (inst >>> 0xC) & 0x7;
            if (mainOp === 1 || mainOp === 6) {
                if ((subOp & 8) !== 0)
                    other = -1;
                subOp &= 7;
            } else if (mainOp === 5)
                other = -1;
            // mainOp 2 is conditional on the angle ordering
            if (mainOp === 1) {
                return handler.interactVec(mainOp, subOp, Source.SELF, Source.POS_X, other);
            } else if (mainOp === 2 || mainOp === 5 || mainOp === 6 || (mainOp === 12 && subOp === 8)) {
                const mainVec = asVec(lower);
                assert(mainVec !== null && mainVec !== undefined);
                return handler.interactVec(mainOp, subOp, mainVec.base, mainVec.source, other);
            }
            return handler.interact(mainOp, subOp, lower, other);
        case Opcode.VECTOR_OP: {
            let vec: Source = Source.POS_X + 3*((inst >>> 0xC) & 7);
            assert(isVec(vec));
            let otherBase = Source.SELF;
            let otherVec :VecSource = Source.POS_X;
            const op = (inst >>> 0x12) & 7;
            if (op === 1 || op === 4 || op === 5) {
                otherVec = Source.POS_X + 3*((inst >>> 0xF) & 7);
                assert(isVec(otherVec));
            } else if (op === 3 || op === 6) {
                otherBase = (inst >>> 0x15) & 0x7;
            }
            return handler.vector(op, vec, lower, otherBase, otherVec);
        }
        case Opcode.SEND_SIGNAL: case Opcode.COLLIDE_ONE: case Opcode.COLLIDE_ALL:
            return handler.signal(op, (inst >>> 0x15) & 0x7, lower, (inst >>> 0x12) & 0x7, (inst >>> 0xC) & 0x3F);
        case Opcode.RECEIVE_SIGNAL_A: case Opcode.RECEIVE_SIGNAL_B:
            assert(((inst >>> 0xA) & 0xF) === 0)
            return handler.receive(op, (inst >>> 0xE) & 0x3F, (inst >>> 0x14) & 3, (inst >>> 0x16) & 3, (inst << 0x16) >> 0x16);
        case Opcode.GET_LIGHTING: case Opcode.SET_LIGHTING:
            return handler.lighting(op, (inst >>> 0xC) & 7, (inst >>> 0xF) & 0x3F, lower);
        case Opcode.NOP: case Opcode.OBJ_NOP: case Opcode.RETURN: case Opcode.EXEC:
            return handler.basic(op);
    }
    return handler.unknown(op, inst);
}

function varString(src: Source): string {
    return Source[src] || `v:${src.toString(16)}`;
}

function opString(op: Opcode): string {
    return Opcode[op] || op.toString(16)
}

function globalString(index: number): string {
    return GlobalVariable[index] || index.toString(16);
}

class InstructionPrinter implements InstructionHandler<string> {
    private argPrinter = new ArgPrinter();
    private chunkArgPrinter = new DecodedArgPrinter();
    private currIndex: number;
    private latestIndex: number;
    private instJump: number;
    private inMIPS = false;
    private behavior: GOOL;

    public print(index: number, behavior: GOOL): string[] {
        let out: string[] = [];
        this.inMIPS = false;
        this.behavior = behavior;
        this.currIndex = index;
        this.latestIndex = index;
        while (this.currIndex <= this.latestIndex) {
            const inst = behavior.scriptView.getUint32(this.currIndex * 4, true);
            this.instJump = 0;

            if (this.inMIPS) {
                if (inst === 0) {
                    this.currIndex++;
                } else if (inst === 0x03E00008) {
                    this.instJump = -2;
                    this.inMIPS = false;
                    out.push(`${this.currIndex} MIPS RETURN`)
                    this.currIndex += 2;
                } else if (inst >>> 0x10 === 0x1000) {
                    const jump = ((inst << 0x10) >> 0x10) - 1;
                    out.push(`${this.currIndex - 1} MIPS JMP ->${jump + this.currIndex + 1}`)
                    this.instJump = Math.max(jump, 0);
                    this.currIndex += 2;
                } else if (inst === 0x03E0A809) {
                    this.currIndex += 2;
                    this.inMIPS = false;
                } else {
                    this.currIndex++;
                    // const res = lookupMIPS(behavior.name, this.currIndex*4, inst, null, null!);
                    // if (res.blockSize < 0) {
                    //     out.push(`missing MIPS ${behavior.name} ${(this.currIndex*4).toString(16)}`);
                    //     return out;
                    // }
                    // out.push(`${this.currIndex - 1} MIPS ${(this.currIndex*4).toString(16)}`)
                    // this.currIndex += res.blockSize >> 2;
                    // this.instJump = res.latestOffset;
                }
            } else {
                this.currIndex++;
                out.push(`${this.currIndex - 1} ${parseInstruction(inst, this)}`);
            }
            this.latestIndex = Math.max(this.latestIndex, this.currIndex + this.instJump);
        }
        return out
    }

    public basic(op: Opcode): string {
        if (op === Opcode.RETURN)
            this.instJump = -1;
        else if (op === Opcode.EXEC)
            this.inMIPS = true;
        return opString(op);
    }
    public binary(op: Opcode, left: Argument, right: Argument): string {
        if (op === Opcode.GET_GLOBAL && getType(left) === ArgType.LITERAL)
            return `${opString(op)}: ${globalString(left! & 0x1FF)}`;
        else if (op === Opcode.SET_GLOBAL && getType(left) === ArgType.LITERAL)
            return `${Opcode[op]}: ${globalString(left! & 0x1FF)} ${this.argString(right)}`;
        else if (op === Opcode.MANAGE_DATA && getType(left) === ArgType.CONST) {
            return `${opString(op)}: ${parseArgument(left, this.chunkArgPrinter, this.behavior.constView)} ${this.argString(right)}`;
        }
        return `${opString(op)}: ${this.argString(left)} ${this.argString(right)}`;
    }
    public optional(op: Opcode, optional: Argument, fixed: Argument): string {
        return this.binary(op, optional, fixed);
    }
    public store(op: Opcode, dest: Argument, arg: Argument): string {
        return this.binary(op, dest, arg);
    }
    public branch(op: Opcode, offset: number, stackOffset: number, condition: Source): string {
        this.instJump = Math.max(offset, 0);
        return `${opString(op)} ${op === Opcode.JMP ? "" : varString(condition)} ->${offset + this.currIndex}` + (stackOffset > 0 ? ` pop(${stackOffset})` : "");
    }
    public setState(op: Opcode, state: number, argCount: number, condition: Source): string {
        let condString = "";
        if (op !== Opcode.SET_STATE)
            condString = `:${varString(condition)}`;
        return `${opString(op)}${condString} ${state} args:${argCount}`;
    }
    public setGeo(model: number, frame: Argument, duration: number, mirror: FrameMirrorOp): string {
        return `${Opcode[Opcode.SET_GEO]} ${model.toString(16)} frame:${this.argString(frame)} ${duration} ${mirror !== FrameMirrorOp.NONE ? mirror : ""}`;
    }
    public spawnChild(fileIndex: number, id: number, count: number, argCount: number): string {
        return `${Opcode[Opcode.SPAWN_CHILD]} ${fileIndex.toString(16)}:${id.toString(16)} args:${argCount} x${count}`;
    }
    public jal(target: number, argCount: number): string {
        return `${Opcode[Opcode.JAL]} ${target.toString()} args:${argCount}`
    }
    public storeScript(dest: Source, address: number): string {
        return `${Opcode[Opcode.STORE_SCRIPT_ADDR]} ${varString(dest)} ${address.toString(16)}`
    };
    public interact(op: number, subOp: number, arg: Argument, other: Source): string {
        return `${Opcode[Opcode.INTERACT_OP]} ${op}.${subOp}(${this.argString(arg)}, ${varString(other)})`;
    }
    public interactVec(op: number, subOp: number, vecBase: Source, vec: VecSource, other: Source): string {
        var otherString = ")"
        if (other >= 0)
            otherString = `, ${varString(other)})`
        return `${Opcode[Opcode.INTERACT_OP]} ${op}.${subOp}(${varString(vecBase)}[${varString(vec)}]`+otherString;
    }
    public vector(op: number, vec: VecSource, param: Argument, other: Source, otherVec: VecSource): string {
        return `${Opcode[Opcode.VECTOR_OP]} ${op}(${varString(vec)}, ${varString(other)}.${varString(otherVec)}, ${this.argString(param)})`;
    }
    public signal(op:Opcode, target: Source, signal: Argument, argCount: number, condition: Source): string {
        return `${opString(op)} ${this.argString(signal)} ->${varString(target)} if:${varString(condition)} #:${argCount}`;
    }
    public receive(op: Opcode, src: Source, srcOp: number, action: number, scriptOffset: number): string {
        var srcString = "";
        if (srcOp !== 0)
            srcString = varString(src);
        if (srcOp === 2)
            srcString = "!" + srcString
        return `${opString(op)} ${srcString} ${action} offs:${scriptOffset}`;
    }
    public water(getNormal: boolean): string {
        return `${Opcode[Opcode.GET_WATER]} normal:${getNormal}`
    }
    public lighting(op: Opcode, base: Source, src: Source, arg: Argument): string {
        if (op === Opcode.GET_LIGHTING)
            return `${Opcode[Opcode.GET_LIGHTING]} ${varString(base)}.${src.toString(16)}`;
        return `${Opcode[Opcode.SET_LIGHTING]} ${varString(base)}.${src.toString(16)} ${this.argString(arg)}`;
    }
    public unknown(op: Opcode, raw: number): string {
        return `!!${opString(op)} ${raw.toString(16)}`;
    }
    private argString(arg: Argument): string {
        return parseArgument(arg, this.argPrinter, this.behavior.constView)
    }
}

const scriptPrinter = new InstructionPrinter();

const enum ExecResult {
    CONTINUE,
    RETURN,
    NEW_STATE,
    DONE,
    ERROR,
    FAILED_SIGNAL,
    IN_MIPS,
}

function bool(b: boolean): number {
    return b ? 1 : 0;
}

export class GameState {
    public t = 0; // in game, time in milliseconds
    public tOffset = 0; // millisecond counter can be reset?
    public frame = 0;
    public dt = 0;
    public objects: CrashObject[] = [];
    public globals: number[] = [];
    public player: CrashObject;
    public root: CrashObject;
    public currObjIndex = -1;
    public instCount = 0;

    constructor(levelID: number, public level: LevelData) {
        this.root = new CrashObject(-1, 0, level.behaviors.get("DispC")!, null!);
        this.player = new CrashObject(-1, 1, level.behaviors.get("DispC")!, null!);
        this.objects.push(this.root);
        this.objects.push(this.player);
        this.player.set(0x41 as NonScriptSource, 0x1000);
        initGlobals(levelID, false, this.globals);
    }

    public debug(behavior: string, offset: number): void {
        for (let s of scriptPrinter.print(offset, assertExists(this.level.behaviors.get(behavior))))
            console.log(s);
    }

    public waterHeight(gridX: number, gridZ: number): number {
        const vtxIndex = 256 * gridZ + gridX;
        const waveIndex = 32 * (gridZ & 31) + (gridX & 31);

        const js = assertExists(this.level.jetski);
        const scale = js.vertexData[vtxIndex * 3 + 1];

        const animIndex = this.frame >> 3;
        const tex0 = js.waveTextures[animIndex % js.waveTextures.length];
        const tex1 = js.waveTextures[(animIndex + 1) % js.waveTextures.length];
        const y0 = this.level.textures[tex0].data[waveIndex * 4 + 3] - 0x80;
        const y1 = this.level.textures[tex1].data[waveIndex * 4 + 3] - 0x80;

        return 4*scale*lerp(y0, y1, (this.frame % 8)/8)/0x7F;
    }

}

const toRad = MathConstants.TAU / 0x1000;

const enum ObjectFlags {
    TARGET_YAW   = 0x00000001,
    BACKWARDS    = 0x00000002,
    PATH_YAW     = 0x00000004,
    GROUND_COL   = 0x00000008,
    PLAYER_COL   = 0x00000010,
    GRAVITY      = 0x00000020,
    KINEMATICS   = 0x00000040,
    MOVE_FORWARD = 0x00000080,
    PATH_PITCH   = 0x00000800,
    CAP_VEL      = 0x00001000,
    TARGET_PITCH = 0x00002000,
    FLOOR_HEIGHT = 0x00004000,
    FOLLOW_PATH  = 0x00008000,
    NO_CULLING   = 0x00040000,
    SIMPLE_YAW   = 0x00080000,
    FIXED_UV     = 0x00100000,
}

const enum CollisionFlags {
    HIT_GROUND = 0x0001,
    ON_PATH = 0x0004,
    NEGATIVE_TURN = 0x0008,
    PATH_CHANGED = 0x0010,
    IN_NEW_STATE = 0x0020,
    VERTICAL_MOTION = 0x0200,
    REACHED_ANGLE = 0x0800,
}

const enum RefFlags {
    ACTIVE = 0x1,
    SINGLE_SPAWN = 0x2,
    UNKNOWN_4 = 0x4,
    TRIGGERED = 0x8,
}

const enum ScriptMode {
    UPDATE,
    PRE_RUN,
    SIGNAL,
}

function approxMag(vec: vec3): number {
    let max = 0, sum = 0;
    for (let i = 0; i < 3; i++) {
        const v = Math.abs(vec[i]);
        if (v > max)
            max = v;
        sum += v;
    }
    return (max + sum) / 2;
}

function atan2(x: number, z: number): number {
    return Math.atan2(x, z) / toRad;
}

interface signalReceiver {
    inUse: boolean;
    wasB: boolean;
    newState: number;
    args: number[];
}

const receivers: signalReceiver[] = nArray(3, () => ({
    inUse: false,
    wasB: false,
    newState: 0,
    args: nArray(10, () => 0),
}));

const scratchVecs = nArray(3, () => vec3.create());
const pathScratch = nArray(3, () => vec3.create());
const hitboxScratch = vec3.create();
const renderScratch: RenderParams = {
    mode: RenderMode.DEFAULT,
    billboard: false,
    skybox: false,
    blendFactor: 0,
    blendColor: vec3.create(),
    diffuse: vec3.create(),
    specular: vec3.create(),
    depthOffset: 0,
    debug: -1,
    textureRemaps: nArray(4, () => ({
        id: -1,
        from: -1,
        to: -1,
    } as WarpTextureRemap)),
    mirrored: false,
};

export class CrashObject {
    public visible = true;
    public index = 0;
    public id = 0;

    public static allDBs: SeriesDatabase[] = [];

    public state: number;
    public scriptOffset = -1;
    private stack = nArray(20, () => 0);
    private stackIndex = 0;
    // frames[frameIndex] will be the index in stack holding the number of arguments
    // for the current frame, with the understanding that those come immediately before
    private frames = nArray(5, () => 0);
    private frameIndex = -1;
    private vars: number[] = [];
    private lastUpdate = -1;

    public placement: ObjectPlacement;
    public db: SeriesDatabase;
    public behavior: GOOL;
    public varBehavior: GOOL;
    public stateBehavior: GOOL;
    public currScriptBehavior: GOOL;

    public pos = vec3.create();
    public euler = vec3.create();
    public scale = vec3.fromValues(1, 1, 1);
    public modelMatrix = mat4.create();

    private nextUpdate = 0;
    public errored = false;
    public alive = true;
    public original = false;
    public refFlags: RefFlags;

    public currScriptStart = 0;
    private runner: InstructionExecutor;
    private interp = new NaiveInterpreter();

    constructor(id: number, index: number, behavior: GOOL, placement: ObjectPlacement) {
        this.reset(id, index, behavior, placement);
        this.runner = new InstructionExecutor(this);
    }

    public reset(id: number, index: number, behavior: GOOL, placement: ObjectPlacement): void {
        this.id = id;
        this.visible = true;
        for (let i = 0; i < this.stack.length; i++)
            this.stack[i] = 0;
        this.stackIndex = 0;
        for (let i = 0; i < this.frames.length; i++)
            this.frames[i] = 0;
        this.frameIndex = -1;
        for (let i = 0; i < this.vars.length; i++)
            this.vars[i] = 0;
        this.lastUpdate = -1;

        vec3.copy(this.pos, Vec3Zero);
        vec3.copy(this.euler, Vec3Zero);
        vec3.copy(this.scale, Vec3One);
        mat4.identity(this.modelMatrix);

        this.nextUpdate = 0;
        this.errored = false;
        this.alive = true;
        this.original = false;
        this.refFlags = RefFlags.ACTIVE;

        this.currScriptStart = 0; // just for debugging
        this.index = index;
        this.setObj(Source.SELF, this);
        this.set(0x3B as NonScriptSource, -2);
        this.set(0x3E as NonScriptSource, 0xFFFF);

        this.placement = placement;
        this.db = placement?.db;
        this.behavior = behavior;
        this.varBehavior = behavior;
        this.currScriptBehavior = behavior;
    }

    public static fromPlacement(placement: ObjectPlacement, behavior: GOOL, game: GameState): CrashObject {
        const obj = new CrashObject(placement.id, placement.lookupIndex, behavior, placement);
        obj.set(Source.PATH_LEN, placement.path.length << 8);
        obj.set(Source.GEO_FORMAT, placement.geoFormat);
        obj.snapToPath(obj.pos, 0);

        vec3.scale(obj.pos, obj.pos, 1 / 0x1000);

        obj.set(Source.LOOKUP_INDEX, obj.index << 8);
        // assert(game.objects[obj.index] === undefined);
        if (game.objects[obj.index] !== undefined) {
            game.objects[obj.index].delete(game);
        }
        game.objects[obj.index] = obj;
        obj.original = true;

        // TODO: figure out what data non-parented objects care about here
        obj.setParent(game.root, game);

        for (let i = 0; i < placement.parameters.length; i++)
            obj.push(placement.parameters[i]);

        obj.setInitialState(placement.parameters.length, game);
        return obj;
    }

    private setInitialState(argCount: number, game: GameState): void {
        const startState = this.behavior.objectIndices[this.id];
        if (startState === undefined || startState === 255) {
            this.errored = true;
            return;
        }
        this.setState(startState, argCount, game);
    }

    public stackFrame(argCount: number): void {
        this.frames[++this.frameIndex] = this.stackIndex;
        this.push(argCount);
        this.push(this.get(Source.SCRIPT_PTR));
    }

    public setParent(parent: CrashObject | null, game: GameState): void {
        const old = this.getObj(Source.PARENT, game);
        if (old) {
            let child = old.getObj(Source.CHILD, game);
            if (child === this) {
                old.set(Source.CHILD, this.get(Source.NEXT));
            } else {
                while (child) {
                    const next = child.getObj(Source.NEXT, game);
                    if (next === this) {
                        child.set(Source.NEXT, this.get(Source.NEXT));
                        break;
                    } else
                        child = next;
                }
            }
        }
        this.setObj(Source.PARENT, parent);
        if (parent) {
            this.set(Source.NEXT, parent.get(Source.CHILD));
            parent.setObj(Source.CHILD, this);
        }

        // check for lack of loop
        let x = game.root.getObj(Source.CHILD, game);
        for (let i = 0; i < game.objects.length; i++) {
            if (!x)
                break;
            x = x.getObj(Source.NEXT, game);
        }
        assert(x === null);
    }

    public shouldUpdate(game: GameState): boolean {
        if (this.lastUpdate === -1) {
            this.lastUpdate = game.frame;
            return true;
        }

        // force update object skyboxes
        if (this.get(Source.DEPTH_OFFSET) < -1000)
            return true;

        let thresh = 1;
        // certain objects, like the skybox, should update even when paused
        // others are effectively frame rate dependent and should be limited
        switch (this.get(Source.OBJECT_ID)) {
            // case 0x580002: case 0x040018:
            //     thresh = 1; break;
            // rings of power lens flares
            case 0x200000: case 0x200003: case 0x300000: case 0x300001:

            case 0x440001: case 0x440002: case 0x440003: case 0x440004:
            case 0x440006: case 0x44000B:

            thresh = 0; break;
        }

        return game.frame >= this.lastUpdate + thresh;
    }

    public tryUpdateSelfAndChildren(game: GameState): void {
        try {
            this.update(game);
        } catch (e) {
            this.errored = true;
            console.warn("exception", this.state, this.id, this.index);
        }
        let child = this.getObj(Source.CHILD, game);
        while (child) {
            const next = child.getObj(Source.NEXT, game);
            child.tryUpdateSelfAndChildren(game);
            child = next;
        }
    }

    public update(game: GameState): void {
        if (this.errored || !this.alive)
            return;
        if (!this.shouldUpdate(game))
            return;
        game.currObjIndex = this.index;
        game.instCount = 0;
        game.dt = (game.frame - this.lastUpdate)/30;

        this.set(Source.LAST_UPDATE, game.frame | 0);
        const preRun = this.get(Source.PRE_RUN);
        if (preRun !== 0) {
            this.stackFrame(0);
            this.setScriptPointer(preRun, game);
            const res = this.runScript(ScriptMode.PRE_RUN, game);
            if (res === ExecResult.DONE)
                this.delete(game);
            if (res !== ExecResult.CONTINUE)
                return;
        }

        if (this.runScript(ScriptMode.UPDATE, game) === ExecResult.DONE) {
            this.delete(game);
            return;
        }

        this.move(game);
        this.applyFlag(Source.COLLISION, CollisionFlags.IN_NEW_STATE, false);

        this.buildMatrix(game);
    }

    private buildMatrix(game: GameState): void {
        const x = this.euler[0] * toRad;
        const y = this.euler[1] * toRad;
        const z = this.euler[2] * toRad;
        let angleOrder = this.get(Source.GEO_FORMAT) & 0xFF;
        if (angleOrder === 0) {
            const info = this.getModelInfo(game);
            if (info?.kind === ModelType.MESH)
                angleOrder = 3;
            else
                angleOrder = 4;
        }
        switch (angleOrder) {
            case 2:
            mat4.fromZRotation(this.modelMatrix, z);
            if (x !== 0)
                mat4.rotateX(this.modelMatrix, this.modelMatrix, x);
            break;
            case 4: case 5: case 6: case 7: case 11: case 12: {
                mat4.fromYRotation(this.modelMatrix, y);
                if (x !== 0)
                    mat4.rotateX(this.modelMatrix, this.modelMatrix, x);
                if (z !== 0)
                    mat4.rotateZ(this.modelMatrix, this.modelMatrix, z);
            } break;
            case 13: case 14: {
                mat4.fromZRotation(this.modelMatrix, z);
                if (x !== 0)
                    mat4.rotateX(this.modelMatrix, this.modelMatrix, x);
                if (y !== 0)
                    mat4.rotateY(this.modelMatrix, this.modelMatrix, y);
            } break;
            default: {
                mat4.fromYRotation(this.modelMatrix, z);
                if (x !== 0)
                    mat4.rotateX(this.modelMatrix, this.modelMatrix, x);
                if (z !== y)
                    mat4.rotateY(this.modelMatrix, this.modelMatrix, y-z);
            } break;
        }
        mat4.scale(this.modelMatrix, this.modelMatrix, this.scale);
        setMatrixTranslation(this.modelMatrix, this.pos);
    }

    public collideAllChildren(obj: CrashObject, src: Source, signal: number, argCount: number, game: GameState, depth = 0): void {
        let child = this.getObj(Source.CHILD, game);
        assert(depth < 10)
        while (child) {
            child.collideAllChildren(obj, src, signal, argCount, game, depth + 1);
            child.collideSelf(obj, src, signal, argCount, game);
            child = child.getObj(Source.NEXT, game);
        }
    }

    public collideSelf(obj: CrashObject, src: Source, signal: number, argCount: number, game: GameState): void {
        if (src === Source.SELF) {
            obj.sendSignal(this, signal, argCount, game);
        }
    }

    private computeHitbox(dst: AABB, index: number, game: GameState): void {
        const model = this.getModelInfo(game);
        if (!model || model.kind !== ModelType.MESH || (index < 0 && index !== -2)) {
            vec3.set(hitboxScratch, Math.abs(this.scale[0]), Math.abs(this.scale[1]), Math.abs(this.scale[2]))
            vec3.scale(hitboxScratch, hitboxScratch, 12.5);
            vec3.add(dst.max, this.pos, this.scale)
            vec3.sub(dst.min, this.pos, this.scale)
            return;
        }
        if (index < 0)
            index = 0;
        const frame = this.svtxIndex(model);
        const hitbox = assertExists(model.mesh.svtx[frame].hitboxen[index]);
        if (hitbox.flags !== 0) {
            assert(hitbox.flags === 1);
            vec3.add(dst.max, hitbox.maxDelta, hitbox.center);
            vec3.add(dst.min, hitbox.minDelta, hitbox.center);
            // also computes a transformed version
        }

    }

    private delete(game: GameState, depth = 0): void {
        // TODO: signal
        assert(depth < 10)
        assert(this.alive)
        this.refFlags &= ~RefFlags.ACTIVE;
        this.alive = false;
        let child = this.getObj(Source.CHILD, game);
        while (child) {
            const nextChild = child.getObj(Source.NEXT, game);
            child.delete(game, depth + 1);
            child = nextChild;
        }
        this.setParent(null, game);
    }

    public snapToPath(dst: vec3, t: number): void {
        if (this.placement === null) {
            console.warn("snap without path", this);
            return;
        }
        let path: ReadonlyVec3[] = this.placement.path;
        if (this.db !== this.placement.db) {
            // console.warn("snapping non-placement path")
            path = assertExists(assertExists(this.db).vecSeries.get(DatabaseKey.PATH))[0];
        }

        const origPos = this.getVec(Source.POS_X, pathScratch[2]);
        let index = Math.abs(t) >> 8;
        let frac = (t & 0xFF) / 0xFF;
        if (index >= path.length) {
            // assert(false)
            console.warn("bad path index", t, path.length);
            t = 0;
            index = 0;
            frac = 0;
        }

        // specifically not absolute value here?
        const atEnd = (t >> 8) >= path.length - 1;
        if (index === path.length - 1 && index !== 0) {
            index--;
            frac++;
        }

        vec3.copy(dst, path[index]);
        if (path.length === 1)
            return;
        const flags = this.get(Source.FLAGS);
        const horizSegment = vec3.sub(pathScratch[0], path[index + 1], path[index]);
        const segY = horizSegment[1];
        horizSegment[1] = 0;

        if (flags & ObjectFlags.FOLLOW_PATH) {
            // find the nearest point on the path
            const fromStart = vec3.sub(pathScratch[1], origPos, dst);
            const threshold = this.get(Source.SNAP_THRESHOLD) * 2;
            if (Math.max(Math.abs(fromStart[0]), Math.abs(fromStart[2])) > threshold) {
                // debugger
                this.errored = true;
                return;
                return this.snapToPath(dst, (index + 1) << 8);
            }

            const segLength = vec3.sqrLen(horizSegment);
            // find best point within segment
            if (segLength < 0x10000) {
                this.applyFlag(Source.COLLISION, CollisionFlags.VERTICAL_MOTION, true);
                this.set(Source.TEMP_VEC_Y, 0);
            } else {
                frac = vec3.dot(horizSegment, fromStart) / segLength;
                if (frac > 1 && !atEnd)
                    return this.snapToPath(dst, (index + 1) << 8);
                vec3.lerp(pathScratch[1], path[index], path[index + 1], frac);
                vec3.sub(pathScratch[1], pathScratch[1], origPos);
                pathScratch[1][1] = 0;
                let snapDist = approxMag(pathScratch[1]);
                if (snapDist > threshold / 2 || (frac < 0 && index == 0) || frac > 1)
                    this.applyFlag(Source.COLLISION, CollisionFlags.VERTICAL_MOTION, true);

                // compute sign of p1 x pos + pos x p0 + p0 x p1, the orientation of the triangle
                vec3.cross(pathScratch[1], horizSegment, origPos);
                const segCrossPos = pathScratch[1][1];
                vec3.cross(pathScratch[1], path[index], path[index + 1]);
                const ptCrossPt = pathScratch[1][1];
                if (segCrossPos + ptCrossPt < 0)
                    snapDist *= -1; // clockwise, on right side of path
                this.set(Source.TEMP_VEC_Y, snapDist);
            }
            this.set(Source.TEMP_A, (t & 0xFFFFFF00) + 0xFF * clamp(frac, 0, 1));
        }

        let oldFlags = this.get(Source.COLLISION);
        const wasOnPath = (oldFlags & CollisionFlags.ON_PATH) !== 0;
        const nowOnPath = this.get(Source.PATH_T) < 0 || atEnd;
        this.applyFlag(Source.COLLISION, CollisionFlags.ON_PATH, nowOnPath);
        this.applyFlag(Source.COLLISION, CollisionFlags.PATH_CHANGED,
            (nowOnPath !== wasOnPath) && (oldFlags & CollisionFlags.PATH_CHANGED) === 0);

        if (flags & ObjectFlags.PATH_YAW) {
            let yaw = atan2(horizSegment[0], horizSegment[2]);
            if ((flags & ObjectFlags.BACKWARDS) && (oldFlags & CollisionFlags.ON_PATH)) {
                yaw += 0x800;
            }
            this.set(Source.TARGET_YAW, yaw);
        }
        if (flags & ObjectFlags.PATH_PITCH) {
            const horiz = approxMag(horizSegment);
            let target = atan2(segY, horiz);
            let roll = atan2(horizSegment[0], horizSegment[2]);
            if (flags & ObjectFlags.PATH_YAW) {
                target *= -1;
            } else {
                roll += 0x800;
            }
            this.set(Source.TARGET_PITCH, target);
            this.set(Source.ROLL, roll);
        }
        vec3.lerp(dst, path[index], path[index + 1], frac);
    }

    private move(game: GameState): void {
        if (this.get(Source.FLAGS) === 0)
            return;
        const oldCollision = this.get(Source.COLLISION);
        const objFlags = this.get(Source.FLAGS);
        if (objFlags & ObjectFlags.MOVE_FORWARD) {

            // adjust speed and target angles based on parameters

            const speed = this.get(Source.SPEED);
            const motionYaw = this.get(Source.TARGET_YAW) * toRad;
            this.set(Source.VEL_X, Math.sin(motionYaw) * speed);
            this.set(Source.VEL_Z, Math.cos(motionYaw) * speed);
        }

        let mask = 0xF8CA207E;
        if (((oldCollision & 1) !== 0) && ((this.get(Source.MOTION) & 0x8) === 0))
            mask |= 0x2000000;
        this.set(Source.COLLISION, oldCollision & mask);

        if (objFlags & ObjectFlags.TARGET_YAW)
            this.turnTowards(Source.YAW, this.get(Source.TARGET_YAW), this.get(Source.YAW_SPEED) * game.dt, true);
        if (objFlags & ObjectFlags.SIMPLE_YAW)
            this.turnTowards(Source.YAW, this.get(Source.TARGET_YAW), this.get(Source.YAW_SPEED) * game.dt, false);
        if (objFlags & ObjectFlags.TARGET_PITCH)
            this.turnTowards(Source.YAW, this.get(Source.TARGET_PITCH), this.get(Source.PITCH_SPEED) * game.dt, false);

        if (objFlags & ObjectFlags.KINEMATICS) {
            this.getVec(Source.POS_X, scratchVecs[0]);
            this.getVec(Source.VEL_X, scratchVecs[1]);
            vec3.scaleAndAdd(scratchVecs[2], scratchVecs[0], scratchVecs[1], game.dt);
            this.setVec(Source.POS_X, scratchVecs[2]);

            if (objFlags & ObjectFlags.FOLLOW_PATH) {
                this.snapToPath(scratchVecs[1], 0);
                this.set(Source.REF_HEIGHT, scratchVecs[1][1]);
                if (this.get(Source.COLLISION) & CollisionFlags.VERTICAL_MOTION)
                    this.setVec(Source.POS_X, scratchVecs[0]); // undo motion
            }

            if (objFlags & ObjectFlags.CAP_VEL) {
                const limit = this.get(Source.VEL_LIMIT);
                for (let i = Source.VEL_X; i < 3; i++) {
                    const v = this.get(Source.VEL_X + i);
                    this.set(Source.VEL_X + i, clamp(v, -limit, limit));
                }
            }

            if ((objFlags & ObjectFlags.FLOOR_HEIGHT) !== 0 && this.get(Source.REF_HEIGHT) >= this.get(Source.POS_Y)) {
                // special logic for motion type 0xA
                this.applyFlag(Source.COLLISION, CollisionFlags.HIT_GROUND, true);
                this.set(Source.POS_Y, this.get(Source.REF_HEIGHT))
                this.set(Source.LAST_GROUND_HIT, game.frame);
                const vel = this.get(Source.VEL_Y);
                if (vel < 0) {
                    this.set(Source.IMPACT_VEL, vel);
                    this.set(Source.VEL_Y, 0);
                }
            }
        }

        if (objFlags & ObjectFlags.GRAVITY) {
            const currVel = this.get(Source.VEL_Y);
            this.set(Source.VEL_Y, Math.max(-0x2EE000, currVel - game.dt * 0x3E8000));
        }

        // player collision
    }

    private turnTowards(src: NonScriptSource, target: number, step: number, smooth: boolean): void {
        if (step === 0)
            return;
        const start = this.get(src);
        const delta = ((target - start) << 0x14) >> 0x14;
        const ratio = Math.abs(delta / step);
        if (smooth && ratio < 4) {
            if (ratio < 1)
                step /= 8;
            else if (ratio < 2)
                step /= 4;
            else if (ratio < 3)
                step /= 2;
            else
                step *= 3 / 4;
        }
        let end = start;
        let flags = this.get(Source.COLLISION);
        if (Math.abs(delta) < step) {
            end = target;
            flags |= CollisionFlags.REACHED_ANGLE;
        } else if (delta < 0) {
            end -= step;
            if (smooth)
                flags |= CollisionFlags.NEGATIVE_TURN;
        } else {
            end += step;
            if (smooth)
                flags &= ~CollisionFlags.NEGATIVE_TURN;
        }
        this.set(src, end);
        this.set(Source.COLLISION, flags);
    }

    private runMIPS(index: number, raw: number, rawNext: number, game: GameState): ExecResult {
        if (raw === 0) {
            this.scriptOffset++;
            return ExecResult.IN_MIPS;
        }
        if (raw === 0x03E0A809 && rawNext === 0) {
            this.scriptOffset += 2;
            return ExecResult.CONTINUE;
        }
        if (raw === 0x03E00008 && rawNext === 0x34150000) {
            return this.doReturn(game);
        }
        if (raw >>> 0x10 === 0x1000 && rawNext === 0) {
            this.scriptOffset += (raw << 0x10) >> 0x10;
            this.scriptOffset++;
            return ExecResult.IN_MIPS;
        }
        // const res = lookupMIPS(this.currScriptBehavior.name, index * 4, raw, this, game);
        // if (res.blockSize < 0) {
        //     console.warn("missing MIPS", this.currScriptBehavior.name, (index*4).toString(16), raw.toString(16), (this.currScriptBehavior.scriptView.byteOffset + (index * 4)).toString(16));
        //     return ExecResult.ERROR; // unknown block
        // }
        // this.scriptOffset += (res.newOffset) >> 2;
        // if (res.newOffset >= 0)
        //     this.scriptOffset += res.blockSize >> 2;
        return ExecResult.IN_MIPS;
    }

    public prepareToRender(globals: RenderGlobals, viewerInput: ViewerRenderInput, game: GameState): void {
        if (!this.visible || !this.alive)
            return;
        const modelInfo = this.getModelInfo(game);
        if (modelInfo === null)
            return;
        let animFrame = this.svtxIndex(modelInfo);
        let uvFrame = -1;
        if (this.get(Source.FLAGS) & ObjectFlags.FIXED_UV) {
            uvFrame = this.get(Source.UV_FRAME);
        }
        const format = this.get(Source.GEO_FORMAT);
        const modelFormat = (format >>> 8) & 0xFF;

        const factor0 = this.get(Source.LIGHTING_INFO | 0) / 0x1000;
        if (factor0 !== 0) {
            renderScratch.blendFactor = factor0;
            vec3.set(renderScratch.blendColor,
                this.get(Source.LIGHTING_INFO | 4),
                this.get(Source.LIGHTING_INFO | 5),
                this.get(Source.LIGHTING_INFO | 6),
            );
        } else {
            renderScratch.blendFactor = this.get(Source.LIGHTING_INFO | 1) / 0x1000;
            vec3.set(renderScratch.blendColor,
                this.get(Source.LIGHTING_INFO | 7),
                this.get(Source.LIGHTING_INFO | 8),
                this.get(Source.LIGHTING_INFO | 9),
            );
        }
        vec3.scale(renderScratch.blendColor, renderScratch.blendColor, 1/0xFF);

        const transformMode = this.get(Source.GEO_FORMAT) & 0xFF;
        if (renderScratch.blendFactor === 0) {
            if (transformMode === 0 || transformMode === 5 || (transformMode >= 8 && (transformMode % 4) <= 1)) {
                const levelID = game.globals[GlobalVariable.LEVEL_ID] >>> 8;
                if ((levelID === 0xE || levelID === 0x1C)) {
                    const waveTheta = ((this.pos[0] + this.pos[2])/2 + game.frame) * MathConstants.TAU / 64;
                    renderScratch.blendFactor = .375 * Math.abs(Math.sin(waveTheta));
                    vec3.set(renderScratch.blendColor, 40/255, 44/255, 48/255);
                }
            }
        }

        renderScratch.depthOffset = this.get(Source.DEPTH_OFFSET);
        if (renderScratch.depthOffset < -1000) {
            // this is likely an object skybox, forced to draw behind everything else
            renderScratch.depthOffset = 0;
            renderScratch.skybox = true;
        } else
            renderScratch.skybox = false;

        if (modelInfo.kind === ModelType.SPRITE) {
            const frame = modelInfo.frames[animFrame % modelInfo.frames.length];
            const billboard = transformMode !== 3;
            // do the blend now, since we didn't set the mesh vertex colors
            vec3.lerp(scratchVecs[0], frame.color, renderScratch.blendColor, renderScratch.blendFactor);
            renderSprite(globals, viewerInput, this.modelMatrix, billboard, frame.uv, frame.code, scratchVecs[0]);
            return;
        }

        const data = globals.meshData[modelInfo.modelIndex];
        if (data instanceof ModelData) {
            assert(modelFormat === 0 || modelFormat >= 6);
            renderScratch.mirrored = this.scale[0] < 0;
            renderScratch.mode = (format >>> 0x10) & 0xFF;

            vec3.set(renderScratch.diffuse,
                this.get(Source.LIGHTING_INFO | 7),
                this.get(Source.LIGHTING_INFO | 8),
                this.get(Source.LIGHTING_INFO | 9),
            );
            vec3.normalize(renderScratch.diffuse, renderScratch.diffuse);
            vec3.set(renderScratch.specular, renderScratch.diffuse[0]-Math.SQRT1_2, renderScratch.diffuse[1] + renderScratch.diffuse[2], Math.SQRT1_2 );
            vec3.normalize(renderScratch.specular, renderScratch.specular);

            renderScratch.billboard = false;
            switch (transformMode) {
                 case 2: case 4: case 6: case 7: case 11: case 12: case 13: case 14: renderScratch.billboard = true;
            }
            renderScratch.debug = this.get(Source.OBJECT_ID);
            assert(transformMode !== 9) // y offset?
            renderMesh(globals, viewerInput, data, this.modelMatrix, animFrame, uvFrame, renderScratch);
        } else if (data instanceof QuadListData) {
            // assert(modelFormat === 2 || modelFormat === 3)
            renderScratch.mode = RenderMode.QUAD_LIST;
            // if (renderScratch.blendFactor !== 0)
            //     debugger
            renderQuadList(globals, viewerInput, data, this.modelMatrix, animFrame, renderScratch);
        } else {
            assert(modelFormat === 4 || modelFormat === 5)
        }
    }

    public getModelInfo(game: GameState): ModelInfo | null {
        const ptr = parsePointer(this.get(Source.GEOMETRY));
        if (ptr.base !== PointerBase.GEOMETRY)
            return null;
        const modelInfo = this.behavior.models.get(ptr.offset);
        if (modelInfo === undefined)
            return null;
        return modelInfo;
    }

    public svtxIndex(model: ModelInfo): number {
        const rawFrame = this.get(Source.ANIM_FRAME) >> 8;
        if (model.kind !== ModelType.MESH || ((model.flags & MeshFlags.INTERPOLATE) === 0))
            return rawFrame;
        if ((rawFrame & 1) && rawFrame + 1 < model.maxFrame)
            return rawFrame / 2;
        else
            return (rawFrame + 1) >>> 1;
    }

    public push(n?: number): void {
        assert(this.stackIndex < 50)
        if (n !== undefined)
            this.stack[this.stackIndex++] = n;
        else
            this.stackIndex++;
    }

    public hasEmptyStack(): boolean {
        return this.stackIndex === this.frames[this.frameIndex] + 2;
    }

    public pop(): number {
        assert(this.stackIndex > this.frames[this.frameIndex] + FRAME_SIZE)
        return this.stack[--this.stackIndex];
    }

    public explicitGetRelStack(relOffset: number): number {
        assert((this.stackIndex + relOffset) >= this.frames[this.frameIndex] + FRAME_SIZE)
        return this.stack[this.stackIndex + relOffset];
    }

    public explicitSetRelStack(val: number, relOffset: number): number {
        this.stack[this.stackIndex + relOffset] = val;
        const frameDelta = this.stackIndex + relOffset - (this.frames[this.frameIndex] + FRAME_SIZE);
        assert(frameDelta >= 0);
        return frameDelta;
    }

    public explicitAdjustStack(offset: number): void {
        this.stackIndex += offset;
    }

    public currStackHeight(): number {
        return this.stackIndex - (this.frames[this.frameIndex] + FRAME_SIZE);
    }

    public set(src: NonScriptSource, value: number): void {
        assert(value !== undefined)
        switch (src) {
            case Source.STACK:
                this.push(value); break;
            case Source.PITCH:
            case Source.YAW:
            case Source.ROLL:
                this.euler[src - Source.PITCH] = value; break;
            case Source.POS_X:
            case Source.POS_Y:
            case Source.POS_Z:
                this.pos[src - Source.POS_X] = value / 0x1000; break;
            case Source.SCALE_X:
            case Source.SCALE_Y:
            case Source.SCALE_Z:
                this.scale[src - Source.SCALE_X] = value / 0x1000; break;
            case Source.REF_FLAGS:
                this.refFlags = value; break;
            case Source.OBJECT_ID:
                assert((value >>> 0x10) === this.behavior.index)
                this.id = value & 0xFFFF; break;
            case Source.LAST_UPDATE:
                this.lastUpdate = value; break;
            case Source.DATABASE: {
                if (value !== 0) {
                    const ptr = parsePointer(value);
                    assert(ptr.base === PointerBase.MISC)
                    this.db = assertExists(CrashObject.allDBs[ptr.offset]);
                } // not sure what to do if zero, hopefully no logic checking...
            } break;
            default:
                this.vars[src] = value | 0;
        }
    }

    public setScriptPointerDirect(behavior: GOOL, offset: number): void {
        this.currScriptBehavior = behavior;
        this.scriptOffset = offset;
        this.currScriptStart = offset;
    }

    public setScriptPointerFromOffset(offset: number): void {
        this.setScriptPointerDirect((offset & 0x4000) ? this.stateBehavior : this.behavior, offset & 0x3FFF);
    }

    public setScriptPointer(value: number, game: GameState): void {
        const ptr = parsePointer(value);
        assert(ptr.base === PointerBase.SCRIPT)
        const index = ptr.offset >>> 0x10;
        const behavior = assertExists(game.level.allBehaviors[index]);
        this.setScriptPointerDirect(behavior, ptr.offset & 0x3FFF);
    }

    public setRelFrame(offset: number, value: number): void {
        if (offset >= 0)
            offset += FRAME_SIZE
        this.stack[this.frames[this.frameIndex] + offset] = value;
    }

    public getRelFrame(index: number): number {
        if (index < 0)
            return this.getParameter(-index);
        return this.stack[this.frames[this.frameIndex] + FRAME_SIZE + index];
    }

    public getParameter(index: number): number {
        return this.stack[this.frames[this.frameIndex] - index];
    }

    public applyFlag(src: NonScriptSource, flag: number, doSet: boolean): void {
        let base = this.get(src);
        if (doSet)
            base |= flag;
        else
            base &= ~flag;
        this.set(src, base);
    }

    public setAngleOrder(fmt: number): void {
        const base = this.get(Source.GEO_FORMAT) & (~0xFF);
        this.set(Source.GEO_FORMAT, base | fmt);
    }


    public get(src: Source): number {
        switch (src) {
            case Source.PLAYER:
                return buildPointer(PointerBase.OBJECT, 1);
            case Source.STACK:
                return this.pop();
            case Source.PITCH:
            case Source.YAW:
            case Source.ROLL:
                return this.euler[src - Source.PITCH];
            case Source.POS_X:
            case Source.POS_Y:
            case Source.POS_Z:
                return this.pos[src - Source.POS_X] * 0x1000;
            case Source.SCALE_X:
            case Source.SCALE_Y:
            case Source.SCALE_Z:
                return this.scale[src - Source.SCALE_X] * 0x1000;
            case Source.OBJECT_ID:
                return (this.behavior.index << 0x10) | this.id;
            case Source.SCRIPT_PTR:
                return buildScriptPointer(this.currScriptBehavior, this.scriptOffset);
            case Source.LAST_UPDATE:
                return this.lastUpdate | 0;
            case Source.DATABASE: {
                return buildPointer(PointerBase.MISC, this.db.globalIndex);
            }
        }
        if (src >= this.behavior.stackStart && !(src & Source.LIGHTING_INFO)) {
            const delta = src - this.behavior.stackStart;
            if (delta < this.frames[0])
                return this.stack[delta] | 0;
            // we're explicitly checking within the current stack frame, this is weird
            // only usage so far is Tiny Tiger checking the base script flags
            // seems like those should always have the same value, though
            // assert(delta === 0);
            return 0xFFFF;
        }

        return (this.vars[src] | 0) || 0;
    }

    public getVec(src: VecSource, dst: vec3): vec3 {
        vec3.zero(dst);
        switch (src) {
            case Source.POS_X:
                vec3.scale(dst, this.pos, 0x1000); break;
            case Source.PITCH:
                vec3.copy(dst, this.euler); break;
            case 0: break;
            default:
                vec3.set(dst, this.get(src + 0), this.get(src + 1), this.get(src + 2)); break;
        }
        return dst;
    }

    public setVec(src: VecSource, vec: ReadonlyVec3): void {
        switch (src) {
            case Source.POS_X:
                vec3.scale(this.pos, vec, 1 / 0x1000); break;
            case Source.SCALE_X:
                vec3.scale(this.scale, vec, 1 / 0x1000); break;
            case Source.PITCH:
                vec3.copy(this.euler, vec); break;
            case 0: break;
            default:
                this.set(src + 0, vec[0]);
                this.set(src + 1, vec[1]);
                this.set(src + 2, vec[2]);
        }
    }

    public getObj(src: Source, game: GameState): CrashObject | null {
        if (src === Source.PLAYER)
            return game.player;
        const ptr = parsePointer(this.get(src));
        if (ptr.base === PointerBase.OBJECT)
            return game.objects[ptr.offset];
        return null;
    }

    public setObj(src: NonScriptSource, obj: CrashObject | null): void {
        if (!obj)
            this.set(src, 0);
        else
            this.set(src, buildPointer(PointerBase.OBJECT, obj.index));
    }

    public runScript(mode: ScriptMode, game: GameState): ExecResult {
        var inMips = false;
        const startFrame = this.frameIndex;
        while (!this.errored) {
            if (mode === ScriptMode.UPDATE && game.frame < this.nextUpdate)
                return ExecResult.CONTINUE;
            if (this.scriptOffset < 0) {
                console.warn("bad offset", this.behavior.name, this.id, this.state, this.index)
                this.debugScript();
                this.errored = true;
                return ExecResult.ERROR;
            }
            const instView = this.currScriptBehavior.scriptView;
            let res: ExecResult;
            if (inMips) {
                // const raw = instView.getUint32(this.scriptOffset * 4, true);
                // const rawNext = instView.getUint32(this.scriptOffset * 4 + 4, true);
                // console.log("exec", this.currScriptBehavior.name, this.scriptOffset, (instView.byteOffset + this.scriptOffset*4).toString(16));
                const newOffset = this.interp.execute(instView, this.scriptOffset * 4, this, game);
                if (this.interp.errored)
                    res = ExecResult.ERROR;
                else if (newOffset === -1)
                    res = this.doReturn(game);
                else {
                    this.scriptOffset = newOffset / 4;
                    res = ExecResult.CONTINUE;
                }
                // res = this.runMIPS(this.scriptOffset, raw, rawNext, game);
            } else {
                const inst = instView.getUint32(this.scriptOffset * 4, true);
                this.scriptOffset++;
                res = this.runner.run(inst, game);
            }
            inMips = false;
            switch (res) {
                case ExecResult.IN_MIPS:
                    inMips = true; break;
                case ExecResult.RETURN: case ExecResult.FAILED_SIGNAL: case ExecResult.NEW_STATE: {
                    if (mode !== ScriptMode.UPDATE && this.frameIndex < startFrame)
                        return ExecResult.CONTINUE;
                } break;
                case ExecResult.ERROR:
                    this.errored = true; // fallthrough
                case ExecResult.DONE:
                    return res;
            }
            if (game.instCount++ > 2000) {
                console.warn("long script exec", mode, this.state, this.id, this.index);
                this.debugScript();
                this.errored = true;
                // this.behavior.scripts.debug(this.currScript);
                return ExecResult.ERROR;
            }
        }
        return ExecResult.ERROR;
    }

    public scriptPointerFromOffset(offset: number | undefined): number {
        if (offset === undefined)
            return 0;
        if (offset & 0x4000)
            return buildScriptPointer(this.stateBehavior, offset & 0x3FFF)
        return buildScriptPointer(this.behavior, offset);
    }


    public setState(newState: number, argCount: number, game: GameState): void {
        const stateData = this.behavior.states[newState];
        this.state = newState;
        this.set(Source.STATE_START, game.frame);
        this.set(Source.INTERACT, stateData.interactFlags);
        this.set(Source.MOTION, stateData.motionFlags);
        this.set(Source.COLLISION, this.get(Source.COLLISION) | 0x20000 | CollisionFlags.IN_NEW_STATE);

        this.stateBehavior = assertExists(game.level.behaviors.get(stateData.altName));
        this.setScriptPointerFromOffset(stateData.script);
        this.set(Source.PRE_RUN, this.scriptPointerFromOffset(stateData.preRun));
        this.set(Source.ON_SIGNAL, this.scriptPointerFromOffset(stateData.onSignal));
        // assume args are currently at the top of the stack
        for (let i = 0; i < argCount; i++)
            this.stack[i] = this.stack[this.stackIndex - argCount + i];
        this.stackIndex = argCount;
        this.nextUpdate = 0;
        this.frameIndex = -1;
        this.stackFrame(argCount);
        if (game.currObjIndex === this.index) {
            const preRun = this.get(Source.PRE_RUN);
            if (preRun !== 0) {
                this.stackFrame(0);
                this.setScriptPointer(preRun, game);
                this.runScript(ScriptMode.PRE_RUN, game);
            }
        }
    }

    public spawnChild(id: number, argCount: number, behavior: GOOL, game: GameState): void {
        let index = -1;
        let newObj: CrashObject | null = null;
        for (let i = 10; i < game.objects.length; i++) {
            if (game.objects[i] && (game.objects[i].original || game.objects[i].alive))
                continue;
            index = i;
            newObj = game.objects[i];
            break;
        }
        if (newObj) {
            newObj.reset(id, index, behavior, this.placement);
        } else {
            if (index < 0)
                index = game.objects.length;
            newObj = new CrashObject(id, index, behavior, this.placement);
            game.objects[index] = newObj;
        }
        vec3.copy(newObj.scale, this.scale);
        vec3.copy(newObj.pos, this.pos);
        vec3.copy(newObj.euler, this.euler);
        newObj.setParent(this, game);
        for (let i = 0; i < argCount; i++)
            newObj.push(this.stack[this.stackIndex - argCount + i]);
        newObj.setInitialState(argCount, game);

        newObj.setObj(Source.SPAWNER, this);
        this.setObj(Source.TEMP_A, newObj);
    }

    public setGeo(modelOffset: number, frame: number, duration: number, mirror: FrameMirrorOp, game: GameState): void {
        if (modelOffset >= 0)
            this.set(Source.GEOMETRY, buildPointer(PointerBase.GEOMETRY, modelOffset));
        if (duration > 0)
            this.nextUpdate = game.frame + duration;
        this.set(Source.ANIM_FRAME, frame);
        const currScale = this.get(Source.SCALE_X);
        switch (mirror) {
            case FrameMirrorOp.FLIP: this.set(Source.SCALE_X, -currScale); break;
            case FrameMirrorOp.POS: this.set(Source.SCALE_X, Math.abs(currScale)); break;
            case FrameMirrorOp.NEG: this.set(Source.SCALE_X, -Math.abs(currScale)); break;
        }
    }

    public sendSignal(target: CrashObject | null, rawSignal: number, argCount: number, game: GameState): void {
        const signal = rawSignal >>> 8;
        if (target === null || signal >= target.behavior.signalIndices.length) {
            this.set(Source.TEMP_A, 0);
            return;
        }
        // console.log("sending", signal, "from", this.index, "to", target.index)
        let newState = 0xFF;
        let receiver: signalReceiver | null = null;
        let receiverIndex = 0;
        for (let i = 0; i < receivers.length; i++) {
            if (receivers[i].inUse)
                continue;
            receiver = receivers[i];
            receiverIndex = i;
            break;
        }
        assert(receiver !== null)

        receiver.newState = -1;
        for (let i = 0; i < argCount; i++)
            receiver.args[i] = this.stack[this.stackIndex - argCount + i];

        this.set(Source.TEMP_A, 1);
        target.setObj(Source.SIGNALLER, this);
        if (target.get(Source.ON_SIGNAL) !== 0 && !target.errored) {
            receiver.inUse = true;

            target.push(rawSignal);
            target.push(buildPointer(PointerBase.RECEIVER, receiverIndex));
            target.stackFrame(2);
            target.setScriptPointer(target.get(Source.ON_SIGNAL), game);
            target.runScript(ScriptMode.SIGNAL, game);

            receiver.inUse = false;
            newState = receiver.newState;
        }
        if (receiver.newState === -1) {
            // didn't hit a specific handler
            newState = target.behavior.signalIndices[signal];
            this.set(Source.TEMP_A, bool(newState !== 0xFF));
            assert((newState & 0x8000) === 0); // this represents an explicit address
        } else {
            this.set(Source.TEMP_A, bool(receiver.wasB))
        }
        if (newState === 0xFF) {
            return
        }
        let flags = target.get(Source.INTERACT);
        if (signal === 0x18 || signal === 0x26 || signal === 0x19 || signal === 0x25) {
            flags &= ~2;
        }
        if (((flags & target.behavior.states[newState].motionFlags ) === 0) && !target.errored) {
            target.set(Source.SIGNAL_VALUE, rawSignal);
            if (signal === 0x18 || signal === 0x19)
                target.applyFlag(Source.COLLISION, 0x10000, true);
            for (let i = 0; i < argCount; i++)
                target.push(receiver.args[i]);
            target.setState(newState, argCount, game);
        } else {
            this.set(Source.TEMP_A, 0);
        }
    }

    public doReturn(game: GameState): ExecResult {
        if (this.frameIndex <= 0)
            return ExecResult.DONE;
        this.stackIndex = this.frames[this.frameIndex--];
        this.setScriptPointer(this.stack[this.stackIndex + 1], game);
        this.stackIndex -= this.stack[this.stackIndex];
        return ExecResult.RETURN;
    }

    private debugVars(): void {
        for (let i = 0; i < this.vars.length && i < 100; i++) {
            if (this.vars[i] === undefined)
                continue;
            console.log(Source[i] || (i).toString(16), this.vars[i].toString(16));
        }
    }

    public debugScript(start = this.currScriptStart): void {
        const behavior = this.currScriptBehavior;
        console.log(behavior.name, this.scriptOffset, start);
        for (let s of scriptPrinter.print(start & 0x3FFF, behavior))
            console.log(s);
    }

}

class InstructionExecutor implements InstructionHandler<ExecResult> {
    private game: GameState;

    constructor(private obj: CrashObject) {}

    public run(inst: number, game: GameState): ExecResult {
        this.game = game;
        return parseInstruction(inst, this);
    }

    private eval(arg: Argument): number {
        return argEvaluator.eval(arg, this.obj, this.game);
    }
    private storeVal(dest: Argument, value: number): void {
        argStorer.store(dest, value, this.obj, this.game);
    }
    private meetsCondition(cond: Source, reqTrue: boolean): boolean {
        const val = this.obj.get(cond) | 0;
        return (val !== 0) === reqTrue;
    }
    public basic(op: Opcode): ExecResult {
        switch (op) {
            case Opcode.RETURN:
                return this.obj.doReturn(this.game);
            case Opcode.EXEC:
                return ExecResult.IN_MIPS;
        }
        return ExecResult.CONTINUE;
    }
    public binary(op: Opcode, leftArg: Argument, rightArg: Argument): ExecResult {
        const right = this.eval(rightArg) | 0;
        const left = this.eval(leftArg) | 0;
        let result = undefined;
        switch (op) {
            case Opcode.ADD: result = left + right; break;
            case Opcode.SUB: result = left - right; break;
            case Opcode.MUL: result = left * right; break;
            case Opcode.DIV: result = (left / right) | 0; break;
            case Opcode.EQ: result = bool(left === right); break;
            case Opcode.LOGICAL_AND: result = left === 0 ? 0 : right; break;
            case Opcode.OR: case Opcode.OR_2:
                result = left | right; break;
            case Opcode.AND: result = left & right; break;
            case Opcode.LT: result = bool(left < right); break;
            case Opcode.LTE: result = bool(left <= right); break;
            case Opcode.GT: result = bool(left > right); break;
            case Opcode.GTE: result = bool(left >= right); break;
            case Opcode.MOD: result = left % right; break;
            case Opcode.XOR: result = left ^ right; break;
            case Opcode.HAS_BITS: result = bool((left & right) === right); break;
            case Opcode.RAND: result = randomRange(left, right) | 0; break;
            case Opcode.SHIFT: {
                if (right >= 0)
                    result = left << right;
                else
                    result = left >> (-right);
            } break;
            case Opcode.VELOCITY: result = left + right * this.game.dt; break;
            case Opcode.EASE: result = right * (1-Math.cos(MathConstants.TAU/2 * left / right)) / 2; break;
            case Opcode.FRAME_MOD: result = (this.game.frame + right) % left; break;
            case Opcode.TWO_VALUES: {
                if (right === 0 && getType(rightArg) === ArgType.BOOL)
                    result = left;
                else {
                    this.obj.push(left);
                    result = right;
                }
            } break;
            case Opcode.TWO_PTRS: {
                this.obj.push(buildPointerFromArg(left));
                result = buildPointerFromArg(right);
            } break;
            case Opcode.SUB_ANGLE: result = ((right - left) << 0x14) >> 0x14; break; // seems backwards?
            case Opcode.GET_GLOBAL: result = this.game.globals[left >>> 8] || 0; break;
            case Opcode.ATAN2: result = atan2(left, right); break;
            // no result
            case Opcode.SET_GLOBAL: this.game.globals[left >>> 8] = right; break;
            case Opcode.JALR: {
                if (left === 0)
                    break;
                this.obj.stackFrame(right);
                this.obj.setScriptPointer(left, this.game);
            } break;
            case Opcode.INDEX: {
                const ptr = parsePointer(left);
                if (ptr.base === 0) {
                    console.warn("nil array", this.obj.behavior.name, this.obj.get(Source.SCRIPT_PTR).toString(16))
                    this.obj.debugScript();
                    result = 0;
                    break;
                }
                if (ptr.base === PointerBase.RECEIVER) {
                    const receiver = receivers[ptr.offset];
                    assert(receiver.inUse);
                    result = receiver.args[right >>> 8];
                } else if (ptr.base === PointerBase.MEMBER) {
                    result = this.obj.get(ptr.offset + (right >>> 8));
                } else {
                    assert(ptr.base === PointerBase.CONSTANTS);
                    result = this.obj.varBehavior.constView.getInt32((ptr.offset + (right >>> 8)) * 4, true);
                }
            } break;
            case Opcode.USE_SPECIAL_TEXTURE: {
                const modelOffs = this.obj.pop() >> 6;
                const vidoID = this.obj.pop();
                const refModel = assertExists(this.obj.behavior.models.get(modelOffs));
                assert(refModel.kind === ModelType.SPRITE);

                assert(right === 0x300); // overwrite both palette and indices, i.e. full texture
                // the way this works is a little crazy, the "refModel" is just for this,
                // and textures are replaced globally across all objects
                // luckily this is only used for warps, so we can be lazy
                const ind = left >> 8;
                for (let i = 0; i < renderScratch.textureRemaps.length; i++) {
                    const target = renderScratch.textureRemaps[i];
                    if (target.id !== vidoID)
                        continue;
                    target.from = refModel.frames[ind].uv.texIndex;
                }
            } break;
            case Opcode.DECOMPRESS_SPECIAL_TEXTURE: {
                this.obj.set(Source.TEMP_A, 0x300); // seems like it will always be a palette + indices
                const texSeq = assertExists(this.game.level.vidos.get(left));
                for (let i = 0; i < renderScratch.textureRemaps.length; i++) {
                    const target = renderScratch.textureRemaps[i];
                    if (target.id !== left)
                        continue;
                    target.to = texSeq[right >> 8];
                }
            } break;
            case Opcode.FREE_SPECIAL_TEXTURE: {
                for (let i = 0; i < renderScratch.textureRemaps.length; i++) {
                    if (renderScratch.textureRemaps[i].id === left) {
                        renderScratch.textureRemaps[i].id = -1;
                        renderScratch.textureRemaps[i].from = -1;
                        renderScratch.textureRemaps[i].to = -1;
                    }
                }
            } break;
            case Opcode.PLAY_SOUND_A: case Opcode.PLAY_SOUND_B:
                break;
            case Opcode.MANAGE_DATA: {
                if (right !== 6)
                    result = 1;
            } break;
            default:
                throw `unhandled binary ${op}`
        }
        if (result !== undefined)
            this.obj.push(result!);
        return ExecResult.CONTINUE;
    }
    public optional(op: Opcode, optionalArg: Argument, fixed: Argument): ExecResult {
        let optional = 0x100;
        let right: number;
        let result = 0;
        if (getType(optionalArg) === ArgType.BOOL && this.eval(optionalArg) === 1) {
            optional = this.obj.pop();
            right = this.obj.pop();
        } else {
            right = this.eval(optionalArg);
        }
        const left = this.eval(fixed);
        switch (op) {
            case Opcode.STEP_TO: {
                optional = Math.abs(optional);
                if (left > right + optional)
                    result = left - optional;
                else if (left < right - optional)
                    result = left + optional
                else
                    result = right;
            } break;
            case Opcode.TURN_TO: {
                const delta = ((right - left) << 0x14) >> 0x14;
                const step = optional * this.game.dt;
                if (Math.abs(delta) <= step)
                    result = right;
                else if (delta >= 0)
                    result = left + step;
                else
                    result = left - step;
            } break;
            case Opcode.OSCILLATE: {
                if (right < 0) {
                    result = left - optional;
                    if (result <= right)
                        result = -2 * optional - right;
                } else {
                    result = left + optional;
                    if (result >= right)
                        result = 2 * optional - right;
                }
                this.storeVal(fixed, result);
                result = Math.abs(result);
            } break;
        }
        this.obj.push(result);
        return ExecResult.CONTINUE;
    }
    public store(op: Opcode, dest: Argument, arg: Argument): ExecResult {
        let result: number;
        const val = this.eval(arg);
        switch (op) {
            case Opcode.STORE:
                result = val; break;
            case Opcode.STORE_NOT: result = bool(val == 0); break;
            case Opcode.STORE_COMPLEMENT: result = ~val; break;
            case Opcode.STORE_ABS: result = Math.abs(val); break;
            case Opcode.STORE_GEO: result = buildPointer(PointerBase.GEOMETRY, val >>> 6); break;
            case Opcode.STORE_DB: {
                const entry = this.obj.db.scalarSeries.get(val >>> 8);
                result = entry ? entry[0][0] : 0;
            } break;
            case Opcode.STORE_PTR: {
                result = buildPointerFromArg(arg);
            } break;
            case Opcode.STORE_COS: result = 0x1000 * Math.cos(val * toRad); break;
            case Opcode.STORE_SIN: result = 0x1000 * Math.sin(val * toRad); break;
            case Opcode.LOAD_SPECIAL_TEXTURE: {
                let found = false;
                for (let i = 0; i < renderScratch.textureRemaps.length; i++) {
                    if (renderScratch.textureRemaps[i].id === -1) {
                        renderScratch.textureRemaps[i].id = val;
                        found = true;
                        break;
                    }
                }
                assert(found);
                result = val;
            } break;
            default:
                throw `unimplemented store ${opString(op)}`
        }
        this.storeVal(dest, result!);
        return ExecResult.CONTINUE;
    }
    public storeScript(dest: NonScriptSource, address: number): ExecResult {
        this.obj.set(dest, this.obj.scriptPointerFromOffset(address));
        return ExecResult.CONTINUE;
    }
    public branch(op: Opcode, offset: number, stackOffset: number, condition: Source): ExecResult {
        if (op === Opcode.JMP || this.meetsCondition(condition, op === Opcode.BNZ)) {
            this.obj.scriptOffset += offset;
            for (let i = 0; i < stackOffset; i++)
                this.obj.pop();
        }
        return ExecResult.CONTINUE;
    }
    public setGeo(model: number, frame: Argument, duration: number, mirror: FrameMirrorOp): ExecResult {
        this.obj.setGeo(model, this.eval(frame), duration, mirror, this.game);
        return ExecResult.CONTINUE;
    }
    public setState(op: Opcode, state: number, argCount: number, condition: Source): ExecResult {
        const meetsCond = op === Opcode.SET_STATE || this.meetsCondition(condition, op === Opcode.SET_STATE_TRUE);

        const flags = this.obj.get(Source.INTERACT);
        const compatible = (flags & this.obj.behavior.states[state].motionFlags) === 0;
        if (!meetsCond || !compatible) {
            for (let i = 0; i < argCount; i++)
                this.obj.pop();
            return ExecResult.CONTINUE;
        }
        this.obj.setState(state, argCount, this.game);
        return ExecResult.NEW_STATE;
    }
    public spawnChild(fileIndex: number, id: number, count: number, argCount: number): ExecResult {
        let spawn = true;
        const name = this.game.level.classNameList[fileIndex];
        if (name === "ShadC")
            spawn = false; // no shadows for now
        if (this.game.objects.length < 500 && spawn) {
            // console.warn('spawn', inst, this.placement);
            for (let i = 0; i < count; i++)
                this.obj.spawnChild(id, argCount, assertExists(this.game.level.behaviors.get(name)), this.game);
        }
        for (let i = 0; i < argCount; i++)
            this.obj.pop();
        return ExecResult.CONTINUE;
    }
    public jal(target: number, argCount: number): ExecResult {
        this.obj.stackFrame(argCount);
        this.obj.setScriptPointerFromOffset(target);
        // this.obj.runScript(ScriptMode.PRE_RUN, this.game);
        return ExecResult.CONTINUE;
    }
    public interact(op: number, subOp: number, arg: Argument, other: Source): ExecResult {
        // do this first in case it's on the stack
        const mainArg = this.eval(arg);
        switch (op) {
            case 3: {
                const otherObj = assertExists(this.obj.getObj(other, this.game));
                this.obj.push(otherObj.get(mainArg >>> 8));
            } break;
            case 4: {
                const otherObj = assertExists(this.obj.getObj(other, this.game));
                otherObj.set(mainArg >>> 8, this.obj.pop());
            } break;
            case 7: {
                const otherObj = this.game.objects[mainArg >>> 8];
                if (otherObj)
                    this.obj.setObj(Source.STACK, otherObj);
                else
                    this.obj.push(0);
            } break;
            case 8: {
                const otherObj = assertExists(this.game.objects[mainArg >>> 8]);
                otherObj.applyFlag(Source.REF_FLAGS, RefFlags.SINGLE_SPAWN, subOp === 0);
            } break;
            case 10: {
                const otherObj = assertExists(this.game.objects[mainArg >>> 8]);
                switch (subOp) {
                    case 0: case 1:
                        otherObj.applyFlag(Source.REF_FLAGS, RefFlags.UNKNOWN_4, subOp === 1); break;
                    case 2: case 3:
                        otherObj.applyFlag(Source.REF_FLAGS, RefFlags.TRIGGERED, subOp === 3); break;
                    case 4: case 5:
                        break; // remove/add from "trigger" queue?
                    case 8: case 9:
                        otherObj.applyFlag(Source.REF_FLAGS, RefFlags.ACTIVE, subOp === 9); break;
                }
            } break;
            case 11: {
                let result = 0;
                if (mainArg !== 0) {
                    const otherObj = assertExists(this.game.objects[mainArg >>> 8]);
                    switch (subOp) {
                        case 1: result = (otherObj.refFlags & RefFlags.SINGLE_SPAWN) === 0 ? 1 : 0; break;
                        case 2: result = otherObj.refFlags & RefFlags.UNKNOWN_4; break;
                        case 3: result = otherObj.refFlags & RefFlags.TRIGGERED; break;
                    }
                }
                this.obj.push(result);
            } break;
            case 12: {
                switch (subOp) {
                    case 1: // reload level
                        break;
                    case 2: {
                        if (other === 1) {
                            const ptr = parsePointer(mainArg);
                            assert(ptr.base === PointerBase.OBJECT);
                            const parent = assertExists(this.game.objects[ptr.offset])
                            this.obj.setParent(parent, this.game);
                        } else {
                            assert(other === 0);
                            this.obj.setParent(this.game.root, this.game);
                        }
                    } break;
                    case 0x10: {
                        const ptr = parsePointer(mainArg);
                        assert(ptr.base === PointerBase.BEHAVIOR);
                        const name = this.game.level.classNameList[ptr.offset];
                        assertExists(this.obj.getObj(other, this.game)).varBehavior = assertExists(this.game.level.behaviors.get(name));
                    } break;
                    case 0x11: {
                        const ptr = parsePointer(mainArg);
                        assert(ptr.base === PointerBase.OBJECT);
                        const other = assertExists(this.game.objects[ptr.offset]);
                        this.obj.push(buildPointer(PointerBase.BEHAVIOR, other.varBehavior.index));
                        break;
                    }
                    default:
                        console.warn("unhandled interact by",this.obj.get(Source.OBJECT_ID).toString(16), op, subOp);
                }
            } break;
            case 13: {
                const otherObj = assertExists(this.obj.getObj(other, this.game));
                let best: CrashObject | null = null;
                let bestDist = -1;
                for (let i = 10; i < this.game.objects.length; i++) {
                    const target = this.game.objects[i];
                    if (!target || !target.alive)
                        continue;
                    if (target === otherObj)
                        continue;
                    if ((subOp & (1 << target.behavior.category)) === 0)
                        continue;
                    const dist = vec3.dist(target.pos, otherObj.pos);
                    if (bestDist >= 0 && dist > bestDist)
                        continue;
                    if (mainArg !== 0xFF) {
                        const index = target.behavior.signalIndices[mainArg >>> 8];
                        if (index !== 0xFF) {
                            assert(mainArg !== 0xF00) // runs a script here
                            // more logic
                        } else if (
                            (mainArg !== 0x300 || (target.get(Source.INTERACT) & 2) !== 0) &&
                            (mainArg !== 0xA00 || (target.get(Source.MOTION) & 0x200) !== 0)
                        ) {
                            if (mainArg !== 0x1D00 || (target.get(Source.MOTION) & 0x800000) !== 0)
                                continue;
                        }
                    }
                    best = target;
                    bestDist = dist;
                }
                if (best)
                    this.obj.setObj(Source.STACK, best);
                else
                    this.obj.push(0);
            } break;
            default:
                console.warn("unhandled interact", op, subOp);
        }
        return ExecResult.CONTINUE;
    }
    public interactVec(op: number, subOp: number, vecBase: Source, vec: VecSource, other: Source): ExecResult {
        const a = scratchVecs[0];
        if (vecBase === Source.FRAME_VECTOR) {
            vec3.set(a,
                this.obj.getRelFrame(vec + 0),
                this.obj.getRelFrame(vec + 1),
                this.obj.getRelFrame(vec + 2),
                )
        } else {
            assertExists(this.obj.getObj(vecBase, this.game)).getVec(vec, a);
        }
        const b = vec3.zero(scratchVecs[1]);
        if (other >= 0)
            assertExists(this.obj.getObj(other, this.game)).getVec(Source.POS_X, b);
        if (op === 1 || op === 6) {
            let res: number;
            switch (subOp) {
                case 0: case 2: case 4: case 6: {
                    vec3.sub(a, a, b);
                    if (subOp === 2 || subOp === 6)
                        a[1] = 0;
                    res = approxMag(a);
                } break;
                case 1:
                    res = vec3.dist(a, b); break;
                case 3: case 7:
                    // 3 is for 1.23.8, 7 for 1.15.16
                    // game truncates to avoid overflow, assuming we don't need to?
                    res = Math.hypot(a[0] - b[0], a[2] - b[2]); break;
                default:
                    throw `unhandled interact ${op}:${subOp}`;
            }
            this.obj.push(res);
        } else if (op === 5) {
            const horiz = (subOp & 1) !== 0;
            const origY = a[1];
            if (horiz)
                a[1] = 0;
            normToLength(scratchVecs[0], this.obj.pop());
            if (horiz)
                a[1] = origY;
            if (vecBase === Source.FRAME_VECTOR) {
                this.obj.setRelFrame(vec + 0, a[0])
                this.obj.setRelFrame(vec + 1, a[1])
                this.obj.setRelFrame(vec + 2, a[2])
            } else {
                assertExists(this.obj.getObj(vecBase, this.game)).setVec(vec, a);
            }
        } else if (op === 12 && subOp === 8) {
            const hdist = Math.hypot(b[0] - a[0], b[2] - a[2]);
            this.obj.push( atan2(b[1] - a[1], hdist));
        } else if (op === 2) {
            // TODO: check axis ordering and use Y instead of Z
            this.obj.push( atan2(a[0] - b[0], a[2] - b[2]));
        } else
            throw `unhandled interact ${op}:${subOp}`;
        return ExecResult.CONTINUE;
    }

    public vector(op: number, vec: VecSource, paramArg: Argument, otherBase: Source, otherVec: VecSource): ExecResult {
        const param = this.eval(paramArg);
        switch (op) {
            case 0: {
                this.obj.getVec(vec, scratchVecs[0]);
                this.obj.snapToPath(scratchVecs[0], param);
                this.obj.set(Source.REF_HEIGHT, scratchVecs[0][1]);
                this.obj.setVec(vec, scratchVecs[0]);
            } break;
            case 2: {
                const yaw = this.obj.get(Source.TARGET_YAW) * toRad;
                this.obj.set(vec + 0, Math.sin(yaw) * param);
                this.obj.set(vec + 2, Math.cos(yaw) * param);
                this.obj.set(Source.SPEED, param);
            } break;
            case 3: case 6: {
                const other = assertExists(this.obj.getObj(otherBase, this.game));
                const otherModel = other.getModelInfo(this.game);
                if (!otherModel || otherModel.kind !== ModelType.MESH || !otherModel.mesh)
                    break;
                const frame = other.svtxIndex(otherModel);
                const first = Math.floor(frame);
                const next = Math.ceil(frame);
                vec3.copy(scratchVecs[0], otherModel.mesh.svtx[first].points[param >>> 8]);
                if (next !== first) {
                    vec3.lerp(scratchVecs[0], scratchVecs[0], otherModel.mesh.svtx[next].points[param >>> 8], 1/2);
                }
                vec3.mul(scratchVecs[0], scratchVecs[0], otherModel.mesh.tgeo.scale);
                vec3.scale(scratchVecs[0], scratchVecs[0], 1/8);
                if (op === 3) {
                    other.getVec(Source.POS_X, scratchVecs[1]);
                    vec3.mul(scratchVecs[0], scratchVecs[0], other.scale);
                    vec3.add(scratchVecs[0], scratchVecs[0], scratchVecs[1]);
                } else
                    transformVec3Mat4w1(scratchVecs[0], other.modelMatrix, scratchVecs[0]);
                vec3.scale(scratchVecs[0], scratchVecs[0], 0x1000);
                this.obj.setVec(vec, scratchVecs[0]);
            } break;
            case 4: case 5: {
                const v = scratchVecs[0];
                v[2] = param;
                v[1] = this.obj.pop();
                v[0] = this.obj.pop();
                if (op === 4) {
                    const other = assertExists(this.obj.getObj(otherBase, this.game));
                    const rot = other.getVec(Source.PITCH, scratchVecs[1]);
                    vec3.scale(rot, rot, toRad);
                    other.getVec(Source.POS_X, scratchVecs[2]);
                    // don't actually use v
                    v[0] = param * Math.cos(rot[0]) * Math.sin(rot[1]);
                    v[1] = param * -Math.sin(rot[0]);
                    v[2] = param * Math.cos(rot[0]) * Math.cos(rot[1]);
                } else {
                    const rot = this.obj.getVec(Source.YAW_SPEED, scratchVecs[1]);
                    vec3.scale(rot, rot, toRad);
                    this.obj.getVec(vec, scratchVecs[2]);
                    vec3.rotateY(v, v, Vec3Zero, rot[1] - rot[2]);
                    vec3.rotateX(v, v, Vec3Zero, rot[0]);
                    vec3.rotateY(v, v, Vec3Zero, rot[2]);
                }
                vec3.add(v, v, scratchVecs[2]);
                this.obj.setVec(otherVec, v);
            } break;
        }
        return ExecResult.CONTINUE;
    }
    public signal(op: Opcode, targetSrc: Source, signalArg: Argument, argCount: number, condition: Source): ExecResult {
        const target = this.obj.getObj(targetSrc, this.game);
        const signal = this.eval(signalArg);
        const cond = this.obj.get(condition);
        if (cond === 0 || target === null || signal === 0) {
            this.obj.set(Source.TEMP_A, 0);
        } else if (op === Opcode.SEND_SIGNAL) {
            this.obj.sendSignal(target, signal, argCount, this.game);
        } else if (op === Opcode.COLLIDE_ONE || op === Opcode.COLLIDE_ALL) {
            target.collideAllChildren(this.obj, targetSrc, signal, argCount, this.game);
            // console.log("collide with", varString(targetSrc), signal.toString(16), this.obj.index)
        }
        for (let i = 0; i < argCount; i++)
            this.obj.pop();
        return ExecResult.CONTINUE;
    }
    public receive(op: Opcode, arg: Source, srcOp: number, action: number, scriptOffset: number): ExecResult {
        const receiverInfo = parsePointer(this.obj.getParameter(1));
        assert(receiverInfo.base === PointerBase.RECEIVER);
        const receiver = receivers[receiverInfo.offset];
        if (!receiver.inUse)
            return ExecResult.FAILED_SIGNAL;
        let value = 1;
        if (srcOp !== 0) {
            value = this.obj.get(arg);
            if (srcOp === 2)
            value = bool(value === 0);
        }
        if (value === 0) {
            if (action === 0) {
                this.obj.scriptOffset += scriptOffset;
            }
            return ExecResult.CONTINUE;
        }
        receiver.newState = 0xFF; // record that we hit a receive
        receiver.wasB = op === Opcode.RECEIVE_SIGNAL_B;
        if (action === 0)
            return ExecResult.CONTINUE;
        if (action === 1)
            receiver.newState = scriptOffset & 0x3FF;
        return this.obj.doReturn(this.game);
    }
    public water(getNormal: boolean): ExecResult {
        const gridX = this.obj.pos[0] >> 6;
        const gridZ = this.obj.pos[2] >> 6;
        let fracX = (this.obj.pos[0] / 64) - gridX;
        let fracZ = (this.obj.pos[2] / 64) - gridZ;

        let base: number, plusX: number, plusZ: number;
        if (fracX + fracZ < 1) {
            base = this.game.waterHeight(gridX, gridZ);
            plusX = this.game.waterHeight(gridX + 1, gridZ);
            plusZ = this.game.waterHeight(gridX, gridZ + 1);
        } else {
            base = this.game.waterHeight(gridX + 1, gridZ + 1);
            plusX = this.game.waterHeight(gridX + 1, gridZ);
            plusZ = this.game.waterHeight(gridX, gridZ + 1);
            fracX = 1 - fracX;
            fracZ = 1 - fracZ;
        }
        const finalHeight = base + (plusX - base)*fracX + (plusZ - base)*fracZ;
        this.obj.push(finalHeight * 0x1000);
        return ExecResult.CONTINUE;
    }
    public lighting(op: Opcode, base: Source, src: Source, arg: Argument): ExecResult {
        const target = assertExists(this.obj.getObj(base, this.game));
        if (op === Opcode.GET_LIGHTING)
            this.obj.push(target.get(Source.LIGHTING_INFO | src));
        else
            target.set(Source.LIGHTING_INFO | src, this.eval(arg));
        return ExecResult.CONTINUE;
    }
    public unknown(op: Opcode, raw: number): ExecResult {
        switch (op) {
            case Opcode.GET_PLAYER_FLAG: {
                this.obj.push(0);
            }; break;
            default:
                // debugger;
        }
        return ExecResult.CONTINUE;
    }
}

interface mipsResult {
    newOffset: number;
    blockSize: number;
    latestOffset: number;
}

const mipsScratch: mipsResult = {
    newOffset: 0,
    blockSize: 0,
    latestOffset: 0,
}


// A simple MIPS interpreter that can only handle mostly-linear functions
// A very small amount of information is kept about branches, and no attempt
// is made to handle loops, nested conditionals, or most register modification
export class NaiveInterpreter {
    public regs: number[] = nArray(32, () => 0);
    public lo = 0;
    public hi = 0;

    public errored = false;

    private popCount = 0;
    private pushBits = 0;

    private currScript = "";
    private startOffset = 0;
    private fileOffset = 0;

    public reset(): void {
        for (let i = 0; i < this.regs.length; i++)
            this.regs[i] = 0;
        this.lo = 0;
        this.hi = 0;
        this.errored = false;
        this.popCount = 0;
        this.pushBits = 0;
    }

    public execute(view: DataView, start: number, obj: CrashObject, game: GameState): number {
        this.reset();
        this.currScript = obj.currScriptBehavior.name;
        this.startOffset = start;
        this.fileOffset = view.byteOffset + start;
        this.regs[RegName.S0] = buildPointer(PointerBase.OBJECT, obj.index);

        let branchDest = -1, inDelay = false, shouldBranch = false;
        let offs = start;
        let instrCount = 0;

        while (true) {
            instrCount++;
            if (instrCount > 2000) {
                this.errored = false;
                console.warn("long executing MIPS", this.currScript, this.fileOffset.toString(16))
                return -1;
            }
            const instr = view.getUint32(offs, true);

            const op = parseMIPSOpcode(instr);
            const rs = (instr >>> 21) & 0x1F;
            const rt = (instr >>> 16) & 0x1F;
            const rd = (instr >>> 11) & 0x1F;
            const sa = (instr >>> 6) & 0x1F;
            const u_imm = instr & 0xFFFF;
            const imm = (u_imm << 16) >> 16;
            switch (op) {
                case MIPS.NOP: break;
                // attempt to retrieve a value from the stack
                case MIPS.LW: {
                    if (rs === RegName.S6) {
                        assert(this.regs[rs] === 0);
                        const stackOffset = imm >> 2;
                        // some very weird usages...
                        // if (imm >= 0)
                        //     assert((this.pushBits & (1 << (obj.currStackHeight() + stackOffset))) !== 0);
                        this.regs[rt] = obj.explicitGetRelStack(stackOffset);
                        this.popCount++;
                    } else if (rs === RegName.S7) {
                        // frame pointer
                        const index = imm >> 2;
                        assert(index < 0 || index >= GAME_FRAME_SIZE);
                        this.regs[rt] = obj.getRelFrame(index < 0 ? index : index - GAME_FRAME_SIZE);
                    } else if (rs === RegName.FP) {
                        // scratch space
                        switch (imm) {
                            case 0x50: this.regs[rt] = game.frame; break;
                            case 0x54: this.regs[rt] = game.dt * 1000; break;
                            case 0x58: this.regs[rt] = buildPointer(PointerBase.MISC, 0); break;
                            default: debugger;
                        }
                    } else if (this.regs[rs] === buildPointer(PointerBase.MISC, 0)) {
                        assert(imm >= 0);
                        this.regs[rt] = game.globals[imm >> 2] || 0;
                    } else {
                        let baseObj: CrashObject | null = null;
                        if (rs === RegName.S0) {
                            baseObj = obj;
                        } else {
                            const ptr = parsePointer(this.regs[rs]);
                            if (ptr.base === PointerBase.OBJECT) {
                                baseObj = game.objects[ptr.offset];
                            }
                        }
                        if (baseObj) {
                            // loading from object
                            assert(imm >= 0x40);
                            const src: Source = (imm - 0x40) >> 2;
                            if (src === Source.STACK) {
                                debugger;
                            } else
                                this.regs[rt] = baseObj.get(src);
                        } else {
                            // bad deref
                            // debugger;
                        }
                    }
                } break;
                case MIPS.SW: {
                    if (rs === RegName.S6) {
                        // object stack pointer
                        // defer push until we actually update the stack pointer
                        assert(this.regs[rs] === 0);
                        const stackOffset = (imm >> 2);
                        // note this might be negative if we popped values off
                        const delta = obj.explicitSetRelStack(this.regs[rt], stackOffset);
                        this.pushBits |= 1 << delta;
                    } else if (rs === RegName.S7) {
                        // frame pointer
                        const stackOffset = (imm >> 2) - GAME_FRAME_SIZE;
                        assert(stackOffset >= 0);
                        obj.setRelFrame(stackOffset, this.regs[rt]);
                        this.pushBits |= 1 << stackOffset;
                    } else if (this.regs[rs] === buildPointer(PointerBase.MISC, 0)) {
                        assert(imm >= 0);
                        game.globals[imm >> 2] = this.regs[rt];
                    } else {
                        let baseObj: CrashObject | null = null;
                        const ptr = parsePointer(this.regs[rs]);
                        if (ptr.base === PointerBase.OBJECT) {
                            baseObj = game.objects[ptr.offset];
                        }
                        if (baseObj) {
                            // loading from object
                            assert(imm >= 0x40);
                            const src: Source = (imm - 0x40) >> 2;
                            assert(src !== Source.SCRIPT_PTR);
                            if (src === Source.STACK) {
                                // only allow stack operations for the current object
                                assert(baseObj === obj);
                                this.reconcileStack(obj, this.regs[rt] >> 2);
                            } else
                                obj.set(src, this.regs[rt]);
                        } else {
                            debugger;
                        }
                    }
                } break;

                case MIPS.SH: {
                    assert(rs === RegName.S0 && imm >= 0x20 && imm <= 0x40);
                    const index = (imm - 0x20) >> 1;
                    obj.set(Source.LIGHTING_INFO | index, this.regs[rt]);
                } break;
                case MIPS.LH: {
                    assert(rs === RegName.S0 && imm >= 0x20 && imm <= 0x40);
                    const index = (imm - 0x20) >> 1;
                    this.regs[rt] =  obj.get(Source.LIGHTING_INFO | index);
                } break;

                case MIPS.DIV: {
                    this.lo = (this.regs[rs] / (this.regs[rt] | 0)) | 0;
                    this.hi = (this.regs[rs] % (this.regs[rt] | 0)) | 0;
                } break;
                case MIPS.MULT: {
                    this.lo = (this.regs[rs] * this.regs[rt]) | 0;
                    this.hi = 0; // assume no overflow
                } break;

                case MIPS.MFHI: this.regs[rd] = this.hi; break;
                case MIPS.MFLO: this.regs[rd] = this.lo; break;


                case MIPS.SLL: this.regs[rd] = this.regs[rt] << sa; break;
                case MIPS.SRA: this.regs[rd] = this.regs[rt] >> sa; break;
                case MIPS.SRL: this.regs[rd] = this.regs[rt] >>> sa; break;
                case MIPS.SLLV: this.regs[rd] = this.regs[rt] << this.regs[rs]; break;
                case MIPS.SRAV: this.regs[rd] = this.regs[rt] >> this.regs[rs]; break;
                case MIPS.SRLV: this.regs[rd] = this.regs[rt] >>> this.regs[rs]; break;

                case MIPS.ADD: case MIPS.ADDU: this.regs[rd] = this.regs[rs] + this.regs[rt]; break;
                case MIPS.SUB: case MIPS.SUBU: this.regs[rd] = this.regs[rs] - this.regs[rt]; break;
                case MIPS.AND: this.regs[rd] = this.regs[rs] & this.regs[rt]; break;
                case MIPS.OR: this.regs[rd] = this.regs[rs] | this.regs[rt]; break;
                case MIPS.XOR: this.regs[rd] = this.regs[rs] ^ this.regs[rt]; break;
                case MIPS.NOR: this.regs[rd] = ~(this.regs[rs] | this.regs[rt]); break;

                case MIPS.ORI: this.regs[rt] = this.regs[rs] | u_imm; break;
                case MIPS.XORI: this.regs[rt] = this.regs[rs] ^ u_imm; break;
                case MIPS.ANDI: this.regs[rt] = this.regs[rs] & u_imm; break;
                case MIPS.ADDIU: this.regs[rt] = this.regs[rs] + imm; break;
                case MIPS.LUI: this.regs[rt] = u_imm << 16; break;

                case MIPS.SLTI: this.regs[rt] = this.regs[rs] < imm ? 1 : 0; break;
                case MIPS.SLTIU: this.regs[rt] = (this.regs[rs] >>> 0) < u_imm ? 1 : 0; break;
                case MIPS.SLT: this.regs[rd] = this.regs[rs] < this.regs[rt] ? 1 : 0; break;

                case MIPS.BEQ: shouldBranch = this.regs[rs] == this.regs[rt]; break;
                case MIPS.BNE: shouldBranch = this.regs[rs] != this.regs[rt]; break;
                case MIPS.BLTZ: shouldBranch = this.regs[rs] < 0; break;
                case MIPS.BGEZ: shouldBranch = this.regs[rs] >= 0; break;

                case MIPS.JALR: {
                    assert(rd === RegName.S5 && rs === RegName.RA);
                    // "continue"
                    assert(view.getUint32(offs + 4, true) === 0);
                    this.reconcileStack(obj, 0);
                    return offs + 8;
                }
                case MIPS.JR: {
                    assert(rs === RegName.RA);
                    assert(view.getUint32(offs + 4, true) === 0x34150000);
                    this.reconcileStack(obj, 0);
                    return -1;
                }
                default:
                    this.errored = true;
                    console.log("unknown instruction", instr.toString(16), op.toString(16), (view.byteOffset + offs).toString(16), (view.byteOffset + start).toString(16))
                    return -1;
                    // unhandled instruction, return invalid
            }
            offs += 4;
            if (this.regs[0] !== 0) {
                debugger
                this.regs[0] = 0;
            }
            if (shouldBranch) {
                assert(!inDelay);
                inDelay = true;
                shouldBranch = false;
                branchDest = offs + 4*imm;
            } else if (inDelay) {
                inDelay = false;
                offs = branchDest;
            }
        }
    }

    private reconcileStack(obj: CrashObject, netShift: number): void {
        const height = obj.currStackHeight();

        // we popped at least popCount times (unused values would be ignored)
        // and then maybe wrote some stack frame slots

        // everything popped was subsequently rewritten
        // note the body of the loop might not execute, e.g. if there were only pops
        // too noisy :(
        // for (let i = height - this.popCount; i < height + netShift; i++) {
        //     if ((this.pushBits & (1 << i)) === 0) {
        //         console.warn("bad push");
        //     }
        // }
        // we didn't write any values which were then popped (could be false)
        // assert((this.pushBits >> (height + netShift)) === 0);

        obj.explicitAdjustStack(netShift);
        // we verified the stack is coherent, so reset
        this.regs[RegName.S6] = 0;
        this.pushBits = 0;
        this.popCount = 0;
    }

}