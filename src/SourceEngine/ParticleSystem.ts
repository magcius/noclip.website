
import { mat4, ReadonlyVec3, ReadonlyVec4, vec3, vec4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { IS_DEVELOPMENT } from "../BuildVersion";
import { computeViewSpaceDepthFromWorldSpacePoint } from "../Camera";
import { Color, colorNewCopy, Magenta, White } from "../Color";
import { drawWorldSpacePoint, getDebugOverlayCanvas2D } from "../DebugJunk";
import { AABB } from "../Geometry";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderInstManager, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager";
import { computeModelMatrixR, getMatrixAxisZ, invlerp, lerp, MathConstants, saturate, scaleMatrix, setMatrixTranslation, smoothstep, transformVec3Mat4w0, transformVec3Mat4w1, Vec3One, Vec3UnitX, Vec3UnitZ, Vec3Zero } from "../MathHelpers";
import { assert, assertExists } from "../util";
import * as DMX from "./DMX";
import { SourceEngineViewType, SourceFileSystem, SourceRenderContext } from "./Main";
import { BaseMaterial } from "./Materials";
import { computeMatrixForForwardDir } from "./StaticDetailObject";
import { ValveKeyValueParser, VKFPair } from "./VMT";

class SeededRNG {
    public state: number;

    public seedRandom(): void {
        this.state = Math.random();
    }

    public copy(o: SeededRNG): void {
        this.state = o.state;
    }

    public nextU32() {
        // Numerical Recipes in C
        this.state = (this.state * 0x19660d + 0x3c6ef35f) >>> 0;
        return this.state;
    }

    public nextF32() {
        return this.nextU32() / 0xFFFFFFFF;
    }
}

type DMXType<T> =
    T extends DMX.DMXAttributeType.Element ? DMX.DMXElement :
    T extends DMX.DMXAttributeType.Int ? number :
    T extends DMX.DMXAttributeType.Float ? number :
    T extends DMX.DMXAttributeType.Bool ? boolean :
    T extends DMX.DMXAttributeType.String ? string :
    T extends DMX.DMXAttributeType.Color ? Color :
    T extends DMX.DMXAttributeType.Vector3 ? ReadonlyVec3 :
    T extends DMX.DMXAttributeType.ElementArray ? DMX.DMXElement[] :
    T extends DMX.DMXAttributeType.IntArray ? number[] :
    T extends DMX.DMXAttributeType.FloatArray ? number[] :
    T extends DMX.DMXAttributeType.BoolArray ? boolean[] :
    T extends DMX.DMXAttributeType.StringArray ? string[] :
    T extends DMX.DMXAttributeType.ColorArray ? Color[] :
    T extends DMX.DMXAttributeType.Vector3Array ? ReadonlyVec3[] :
    unknown;

function getAttribValue<T extends DMX.DMXAttributeType>(elem: DMX.DMXElement, name: string, type: T, defaultValue: DMXType<T> | null): DMXType<T> {
    const attrib = elem.attributes.find((attrib) => attrib.name === name);
    if (attrib === undefined) {
        if (defaultValue !== null)
            return defaultValue;
        else
            throw "whoops";
    }
    assert(attrib.type === type);
    return attrib.value as DMXType<T>;
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec4a = vec4.create();
const scratchVec4b = vec4.create();
const scratchMat4a = mat4.create();
const scratchMat4b = mat4.create();

// These need to match, because some operator data relies on field indices
// https://github.com/ValveSoftware/source-sdk-2013/blob/master/mp/src/public/particles/particles.h#L62-L115
const enum StreamMask {
    None          = 0,
    Position      = 1 << 0,
    Lifetime      = 1 << 1,
    PrevPosition  = 1 << 2,
    Radius        = 1 << 3,
    Rotation      = 1 << 4,
    RotationSpeed = 1 << 5,
    Color         = 1 << 6,
    Alpha         = 1 << 7,
    SpawnTime     = 1 << 8,
    SequenceNum   = 1 << 9,
    TrailLength   = 1 << 10,
    ParticleID    = 1 << 11,
    RotYaw        = 1 << 12,
    SequenceNum2  = 1 << 13,
    HitboxIndex   = 1 << 14,
    HitboxPos     = 1 << 15,
    Alpha2        = 1 << 16,
}

function getStreamStride(bit: StreamMask): number {
    if (bit === StreamMask.Position)
        return 3;
    else if (bit === StreamMask.Lifetime)
        return 1;
    else if (bit === StreamMask.PrevPosition)
        return 3;
    else if (bit === StreamMask.Radius)
        return 1;
    else if (bit === StreamMask.Rotation)
        return 1;
    else if (bit === StreamMask.RotationSpeed)
        return 1;
    else if (bit === StreamMask.Color)
        return 3;
    else if (bit === StreamMask.Alpha)
        return 1;
    else if (bit === StreamMask.SpawnTime)
        return 1;
    else if (bit === StreamMask.SequenceNum)
        return 1;
    else if (bit === StreamMask.TrailLength)
        return 1;
    else if (bit === StreamMask.ParticleID)
        return 1;
    else if (bit === StreamMask.RotYaw)
        return 1;
    else if (bit === StreamMask.SequenceNum2)
        return 1;
    else
        throw "whoops";
}

abstract class ModuleBase {
    constructor(elem: DMX.DMXElement) {
    }

    public streamRead(): StreamMask {
        return StreamMask.None;
    }

    public streamReadInit(): StreamMask {
        return StreamMask.None;
    }

    public streamReadOptional(): StreamMask {
        return StreamMask.None;
    }

    public streamWrite(): StreamMask {
        return StreamMask.None;
    }
}

abstract class OperatorBase extends ModuleBase {
    private startFadeIn: number;
    private startFadeOut: number;
    private endFadeIn: number;
    private endFadeOut: number;
    private fadeOscillate: number;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.startFadeIn = getAttribValue(elem, `operator start fadein`, DMX.DMXAttributeType.Float, 0);
        this.endFadeIn = getAttribValue(elem, `operator end fadein`, DMX.DMXAttributeType.Float, 0);
        this.startFadeOut = getAttribValue(elem, `operator start fadeout`, DMX.DMXAttributeType.Float, 0);
        this.endFadeOut = getAttribValue(elem, `operator end fadeout`, DMX.DMXAttributeType.Float, 0);
        this.fadeOscillate = getAttribValue(elem, `operator fade oscillate`, DMX.DMXAttributeType.Float, 0);
    }

    public calcWeight(curTime: number): number {
        if (curTime >= this.startFadeIn && curTime <= this.endFadeIn)
            return invlerp(this.startFadeIn, this.startFadeOut, curTime);
        else if (curTime >= this.startFadeOut && curTime <= this.endFadeOut)
            return invlerp(this.startFadeOut, this.endFadeOut, curTime);
        else
            return 1.0;
    }
}

interface Initializer extends ModuleBase {
    init(system: ParticleSystemInstance, p: number): void;
}

function randRangeExp(system: ParticleSystemInstance, min: number, max: number, randomExponent: number): number {
    if (min === max) {
        return min;
    } else {
        let v = system.randF32();
        v **= randomExponent;
        v = lerp(min, max, v);
        return v;
    }
}

function randRangeExpOp(system: ParticleSystemInstance, p: number, o: number, min: number, max: number, randomExponent: number): number {
    if (min === max) {
        return min;
    } else {
        let v = system.randF32Op(p, o);
        v **= randomExponent;
        v = lerp(min, max, v);
        return v;
    }
}

function randInAABB(dst: vec3, system: ParticleSystemInstance, min: ReadonlyVec3, max: ReadonlyVec3): void {
    for (let i = 0; i < 3; i++) {
        if (min[i] === max[i])
            dst[i] = min[i];
        else
            dst[i] = lerp(min[i], max[i], system.randF32());
    }
}

class Initializer_PositionWithinSphereRandom extends ModuleBase {
    private readonly distMin: number;
    private readonly distMax: number;
    private readonly distBias: ReadonlyVec3;
    private readonly distBiasInLocalCoords: boolean;
    private readonly controlPointNo: number;
    private readonly speedMin: number;
    private readonly speedMax: number;
    private readonly speedRandomExponent: number;
    private readonly speedInLocalCoordinateSystemMin: ReadonlyVec3;
    private readonly speedInLocalCoordinateSystemMax: ReadonlyVec3;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.distMin = getAttribValue(elem, `distance_min`, DMX.DMXAttributeType.Float, 0);
        this.distMax = getAttribValue(elem, `distance_max`, DMX.DMXAttributeType.Float, 0);
        this.distBias = getAttribValue(elem, `distance_bias`, DMX.DMXAttributeType.Vector3, Vec3Zero);
        this.distBiasInLocalCoords = getAttribValue(elem, `bias in local system`, DMX.DMXAttributeType.Bool, false);
        this.controlPointNo = getAttribValue(elem, `control_point_number`, DMX.DMXAttributeType.Int, 0);
        this.speedMin = getAttribValue(elem, `speed_min`, DMX.DMXAttributeType.Float, 0);
        this.speedMax = getAttribValue(elem, `speed_max`, DMX.DMXAttributeType.Float, 0);
        this.speedRandomExponent = getAttribValue(elem, `speed_random_exponent`, DMX.DMXAttributeType.Float, 1);
        this.speedInLocalCoordinateSystemMin = getAttribValue(elem, `speed_in_local_coordinate_system_min`, DMX.DMXAttributeType.Vector3, Vec3Zero);
        this.speedInLocalCoordinateSystemMax = getAttribValue(elem, `speed_in_local_coordinate_system_max`, DMX.DMXAttributeType.Vector3, Vec3Zero);
    }

    public override streamWrite(): StreamMask {
        return StreamMask.Position | StreamMask.PrevPosition;
    }

    public init(system: ParticleSystemInstance, p: number): void {
        const data = system.particleDataF32;
        const spawnTime = system.curTime;
        system.getControlPointTransform(scratchMat4a, this.controlPointNo, spawnTime);

        vec3.random(scratchVec3a);

        if (!vec3.exactEquals(this.distBias, Vec3One)) {
            vec3.mul(scratchVec3a, scratchVec3a, this.distBias);
            vec3.normalize(scratchVec3a, scratchVec3a);
        }

        let distance: number;
        if (this.distMin === this.distMax) {
            distance = this.distMin;
        } else {
            distance = Math.random();
            distance = 1.0 - (distance ** 3.0);
            distance = lerp(this.distMin, this.distMax, distance);
        }
        vec3.scale(scratchVec3b, scratchVec3a, distance);

        if (this.distBiasInLocalCoords) {
            transformVec3Mat4w1(scratchVec3b, scratchMat4a, scratchVec3b);
        } else {
            scratchVec3b[0] += scratchMat4a[12];
            scratchVec3b[1] += scratchMat4a[13];
            scratchVec3b[2] += scratchMat4a[14];
        }

        const posOffs = system.getStreamOffs(StreamMask.Position, p);
        data[posOffs + 0] = scratchVec3b[0];
        data[posOffs + 1] = scratchVec3b[1];
        data[posOffs + 2] = scratchVec3b[2];

        if (system.hasStream(StreamMask.PrevPosition)) {
            const speed = randRangeExp(system, this.speedMin, this.speedMax, this.speedRandomExponent);
            vec3.scale(scratchVec3b, scratchVec3a, speed);

            randInAABB(scratchVec3a, system, this.speedInLocalCoordinateSystemMin, this.speedInLocalCoordinateSystemMax);
            transformVec3Mat4w0(scratchVec3a, scratchMat4a, scratchVec3a);
            vec3.add(scratchVec3b, scratchVec3b, scratchVec3a);

            const prevPositionOffs = system.getStreamOffs(StreamMask.PrevPosition, p);
            data[prevPositionOffs + 0] = data[posOffs + 0] - scratchVec3b[0] * system.deltaTime;
            data[prevPositionOffs + 1] = data[posOffs + 1] - scratchVec3b[1] * system.deltaTime;
            data[prevPositionOffs + 2] = data[posOffs + 2] - scratchVec3b[2] * system.deltaTime;
        }
    }
}

class Initializer_LifetimeRandom extends ModuleBase {
    private readonly min: number;
    private readonly max: number;
    private readonly randomExponent: number;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.min = getAttribValue(elem, `lifetime_min`, DMX.DMXAttributeType.Float, 0);
        this.max = getAttribValue(elem, `lifetime_max`, DMX.DMXAttributeType.Float, 0);
        this.randomExponent = getAttribValue(elem, `lifetime_random_exponent`, DMX.DMXAttributeType.Float, 1);
    }

    public override streamWrite(): StreamMask {
        return StreamMask.Lifetime;
    }

    public init(system: ParticleSystemInstance, p: number): void {
        if (!system.hasStream(StreamMask.Lifetime))
            return;

        const lifetime = randRangeExp(system, this.min, this.max, this.randomExponent);

        const data = system.particleDataF32;
        data[system.getStreamOffs(StreamMask.Lifetime, p)] = lifetime;
    }
}

class Initializer_AlphaRandom extends ModuleBase {
    private readonly min: number;
    private readonly max: number;
    private readonly randomExponent: number;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.min = getAttribValue(elem, `alpha_min`, DMX.DMXAttributeType.Int, 0xFF) / 0xFF;
        this.max = getAttribValue(elem, `alpha_max`, DMX.DMXAttributeType.Int, 0xFF) / 0xFF;
        this.randomExponent = getAttribValue(elem, `alpha_random_exponent`, DMX.DMXAttributeType.Float, 1);
    }

    public override streamWrite(): StreamMask {
        return StreamMask.Alpha;
    }

    public init(system: ParticleSystemInstance, p: number): void {
        if (!system.hasStream(StreamMask.Alpha))
            return;

        const alpha = randRangeExp(system, this.min, this.max, this.randomExponent);

        const data = system.particleDataF32;
        data[system.getStreamOffs(StreamMask.Alpha, p)] = alpha;
    }
}

class Initializer_ColorRandom extends ModuleBase {
    private readonly color1: Readonly<Color>;
    private readonly color2: Readonly<Color>;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.color1 = getAttribValue(elem, `color1`, DMX.DMXAttributeType.Color, White);
        this.color2 = getAttribValue(elem, `color2`, DMX.DMXAttributeType.Color, White);
        // TODO(jstpierre): Tint?
    }

    public override streamWrite(): StreamMask {
        return StreamMask.Color;
    }

    public init(system: ParticleSystemInstance, p: number): void {
        if (!system.hasStream(StreamMask.Color))
            return;

        const t = system.randF32();

        const r = lerp(this.color1.r, this.color2.r, t);
        const g = lerp(this.color1.g, this.color2.g, t);
        const b = lerp(this.color1.b, this.color2.b, t);

        const data = system.particleDataF32;
        const offs = system.getStreamOffs(StreamMask.Color, p);
        data[offs + 0] = r;
        data[offs + 1] = g;
        data[offs + 2] = b;
    }
}

class Initializer_RadiusRandom extends ModuleBase {
    private readonly min: number;
    private readonly max: number;
    private readonly randomExponent: number;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.min = getAttribValue(elem, `radius_min`, DMX.DMXAttributeType.Float, 1);
        this.max = getAttribValue(elem, `radius_max`, DMX.DMXAttributeType.Float, 1);
        this.randomExponent = getAttribValue(elem, `radius_random_exponent`, DMX.DMXAttributeType.Float, 1);
    }

    public override streamWrite(): StreamMask {
        return StreamMask.Radius;
    }

    public init(system: ParticleSystemInstance, p: number): void {
        if (!system.hasStream(StreamMask.Radius))
            return;

        const radius = randRangeExp(system, this.min, this.max, this.randomExponent);

        const data = system.particleDataF32;
        data[system.getStreamOffs(StreamMask.Radius, p)] = radius;
    }
}

class Initializer_TrailLengthRandom extends ModuleBase {
    private readonly min: number;
    private readonly max: number;
    private readonly randomExponent: number;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.min = getAttribValue(elem, `length_min`, DMX.DMXAttributeType.Float, 0.1);
        this.max = getAttribValue(elem, `length_max`, DMX.DMXAttributeType.Float, 0.1);
        this.randomExponent = getAttribValue(elem, `length_random_exponent`, DMX.DMXAttributeType.Float, 1.0);
    }

    public override streamWrite(): StreamMask {
        return StreamMask.TrailLength;
    }

    public init(system: ParticleSystemInstance, p: number): void {
        if (!system.hasStream(StreamMask.TrailLength))
            return;

        const trailLength = randRangeExp(system, this.min, this.max, this.randomExponent);

        const data = system.particleDataF32;
        data[system.getStreamOffs(StreamMask.TrailLength, p)] = trailLength;
    }
}

class Initializer_PositionModifyOffsetRandom extends ModuleBase {
    private readonly min: ReadonlyVec3;
    private readonly max: ReadonlyVec3;
    private readonly inLocalSpace: boolean;
    private readonly proportionalToRadius: boolean;
    private readonly controlPointNo: number;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.min = getAttribValue(elem, `offset min`, DMX.DMXAttributeType.Vector3, Vec3Zero);
        this.max = getAttribValue(elem, `offset max`, DMX.DMXAttributeType.Vector3, Vec3Zero);
        this.inLocalSpace = getAttribValue(elem, `offset in local space 0/1`, DMX.DMXAttributeType.Bool, false);
        this.proportionalToRadius = getAttribValue(elem, `offset proportional to radius 0/1`, DMX.DMXAttributeType.Bool, false);
        this.controlPointNo = getAttribValue(elem, `control_point_number`, DMX.DMXAttributeType.Int, 0);
    }

    public override streamRead(): StreamMask {
        let mask = StreamMask.Position;
        if (this.proportionalToRadius)
            mask |= StreamMask.Radius;
        // if (this.inLocalSpace)
        //     mask |= StreamMask.SpawnTime;
        return mask;
    }

    public override streamWrite(): StreamMask {
        return StreamMask.Position;
    }

    public init(system: ParticleSystemInstance, p: number): void {
        const data = system.particleDataF32;

        randInAABB(scratchVec3a, system, this.min, this.max);

        if (this.proportionalToRadius) {
            const radiusOffs = system.getStreamOffs(StreamMask.Radius, p);
            vec3.scale(scratchVec3a, scratchVec3a, data[radiusOffs]);
        }

        if (this.inLocalSpace) {
            const spawnTime = system.curTime;
            system.getControlPointTransform(scratchMat4a, this.controlPointNo, spawnTime);
            transformVec3Mat4w0(scratchVec3a, scratchMat4a, scratchVec3a);
        }

        const posOffs = system.getStreamOffs(StreamMask.Position, p);
        data[posOffs + 0] += scratchVec3a[0];
        data[posOffs + 1] += scratchVec3a[1];
        data[posOffs + 2] += scratchVec3a[2];

        if (system.hasStream(StreamMask.PrevPosition)) {
            const prevPosOffs = system.getStreamOffs(StreamMask.PrevPosition, p);
            data[prevPosOffs + 0] += scratchVec3a[0];
            data[prevPosOffs + 1] += scratchVec3a[1];
            data[prevPosOffs + 2] += scratchVec3a[2];
        }
    }
}

class Initializer_RotationRandom extends ModuleBase {
    private readonly initial: number;
    private readonly min: number;
    private readonly max: number;
    private readonly randomExponent: number;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.initial = getAttribValue(elem, `rotation_initial`, DMX.DMXAttributeType.Float, 0) * MathConstants.DEG_TO_RAD;
        this.min = getAttribValue(elem, `rotation_offset_min`, DMX.DMXAttributeType.Float, 0) * MathConstants.DEG_TO_RAD;
        this.max = getAttribValue(elem, `rotation_offset_max`, DMX.DMXAttributeType.Float, 360) * MathConstants.DEG_TO_RAD;
        this.randomExponent = getAttribValue(elem, `rotation_random_exponent`, DMX.DMXAttributeType.Float, 1);
    }

    public override streamWrite(): StreamMask {
        return StreamMask.Rotation;
    }

    public init(system: ParticleSystemInstance, p: number): void {
        if (!system.hasStream(StreamMask.Rotation))
            return;

        const rotation = this.initial + randRangeExp(system, this.min, this.max, this.randomExponent);

        const data = system.particleDataF32;
        data[system.getStreamOffs(StreamMask.Rotation, p)] = rotation;
    }
}

class Initializer_SequenceRandom extends ModuleBase {
    private readonly min: number;
    private readonly max: number;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.min = getAttribValue(elem, `sequence_min`, DMX.DMXAttributeType.Int, 0);
        this.max = getAttribValue(elem, `sequence_max`, DMX.DMXAttributeType.Int, 0);
    }

    public override streamWrite(): StreamMask {
        return StreamMask.SequenceNum;
    }

    public init(system: ParticleSystemInstance, p: number): void {
        if (!system.hasStream(StreamMask.SequenceNum))
            return;

        const sequenceNum = lerp(this.min, this.max + 1, system.randF32()) | 0;

        const data = system.particleDataF32;
        data[system.getStreamOffs(StreamMask.SequenceNum, p)] = sequenceNum;
    }
}

class Initializer_SequenceTwoRandom extends ModuleBase {
    private readonly min: number;
    private readonly max: number;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.min = getAttribValue(elem, `sequence_min`, DMX.DMXAttributeType.Int, 0);
        this.max = getAttribValue(elem, `sequence_max`, DMX.DMXAttributeType.Int, 0);
    }

    public override streamWrite(): StreamMask {
        return StreamMask.SequenceNum2;
    }

    public init(system: ParticleSystemInstance, p: number): void {
        if (!system.hasStream(StreamMask.SequenceNum2))
            return;

        const sequenceNum = lerp(this.min, this.max + 1, system.randF32()) | 0;

        const data = system.particleDataF32;
        data[system.getStreamOffs(StreamMask.SequenceNum2, p)] = sequenceNum;
    }
}

class Initializer_LifetimeFromSequence extends ModuleBase {
    private readonly framesPerSecond: number;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.framesPerSecond = getAttribValue(elem, `Frames Per Second`, DMX.DMXAttributeType.Float, 30);
    }

    public override streamRead(): StreamMask {
        return StreamMask.SequenceNum;
    }

    public override streamWrite(): StreamMask {
        return StreamMask.Lifetime;
    }

    public init(system: ParticleSystemInstance, p: number): void {
        if (!system.hasStream(StreamMask.Lifetime))
            return;

        const sheet = system.getSheet();
        if (sheet === null)
            return;

        const data = system.particleDataF32;
        const sequenceNum = data[system.getStreamOffs(StreamMask.SequenceNum, p)];

        const lifetime = sheet.sequence[sequenceNum].frames.length / this.framesPerSecond;
        data[system.getStreamOffs(StreamMask.Lifetime, p)] = lifetime;
    }
}

function createInitializer(elem: DMX.DMXElement): Initializer | null {
    const functionName = getAttribValue(elem, `functionName`, DMX.DMXAttributeType.String, null);
    if (functionName === 'Position Within Sphere Random')
        return new Initializer_PositionWithinSphereRandom(elem);
    else if (functionName === 'Lifetime Random')
        return new Initializer_LifetimeRandom(elem);
    else if (functionName === 'Alpha Random')
        return new Initializer_AlphaRandom(elem);
    else if (functionName === 'Color Random')
        return new Initializer_ColorRandom(elem);
    else if (functionName === 'Radius Random')
        return new Initializer_RadiusRandom(elem);
    else if (functionName === 'Trail Length Random')
        return new Initializer_TrailLengthRandom(elem);
    else if (functionName === 'Position Modify Offset Random')
        return new Initializer_PositionModifyOffsetRandom(elem);
    else if (functionName === 'Rotation Random')
        return new Initializer_RotationRandom(elem);
    else if (functionName === 'Sequence Random')
        return new Initializer_SequenceRandom(elem);
    else if (functionName === 'Sequence Two Random')
        return new Initializer_SequenceTwoRandom(elem);
    else if (functionName === `lifetime from sequence`)
        return new Initializer_LifetimeFromSequence(elem);

    console.log(`Unknown Initializer`, functionName)
    return null;
}

interface Emitter extends ModuleBase {
    isEmitActive(system: ParticleSystemInstance): boolean;
    emit(system: ParticleSystemInstance): void;
}

class Emitter_Continuously extends ModuleBase {
    private readonly rate: number;
    private readonly duration: number;
    private readonly startTime: number;
    private emitCounter = 0;
    private particleEmitNum = 0;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.rate = getAttribValue(elem, `emission_rate`, DMX.DMXAttributeType.Float, 100);
        this.duration = getAttribValue(elem, `emission_duration`, DMX.DMXAttributeType.Float, 0);
        this.startTime = getAttribValue(elem, `emission_start_time`, DMX.DMXAttributeType.Float, 0);
    }

    public override streamWrite(): StreamMask {
        return StreamMask.SpawnTime | StreamMask.ParticleID;
    }

    public hasDuration(): boolean {
        return this.duration > 0.0;
    }

    public isEmitActive(system: ParticleSystemInstance): boolean {
        if (this.hasDuration()) {
            const endTime = this.startTime + this.duration;
            if (system.curTime >= endTime)
                return false;
        }

        return true;
    }

    public emit(system: ParticleSystemInstance): void {
        const rate = this.rate;
        if (rate <= 0.0)
            return;

        const curTime = system.curTime;
        if (curTime <= this.startTime)
            return;

        if (!this.isEmitActive(system))
            return;

        let prevTime = curTime - system.deltaTime;
        if (prevTime < this.startTime)
            prevTime = this.startTime;

        this.emitCounter += (rate * (curTime - prevTime));
        const newEmitNum = (this.emitCounter | 0);
        const numParticlesToEmit = newEmitNum - this.particleEmitNum;
        const startP = system.createParticles(numParticlesToEmit), num = system.getNum();
        if (startP === num)
            return;

        this.particleEmitNum = newEmitNum;

        const data = system.particleDataF32, stride = system.dataStride;

        if (system.hasStream(StreamMask.SpawnTime)) {
            let spawnTime = prevTime, spawnTimeStep = 1.0 / rate;
            let spawnTimeOffs = system.getStreamOffs(StreamMask.SpawnTime, startP);
            for (let p = startP; p < num; p++) {
                data[spawnTimeOffs] = spawnTime;
                spawnTime += spawnTimeStep;
                spawnTimeOffs += stride;
            }
        }

        if (system.hasStream(StreamMask.ParticleID)) {
            let particleIDOffs = system.getStreamOffs(StreamMask.ParticleID, startP);
            for (let p = startP; p < num; p++) {
                data[particleIDOffs] = system.particleNextID++;
                particleIDOffs += stride;
            }
        }
    }
}

function createEmitter(elem: DMX.DMXElement): Emitter | null {
    const functionName = getAttribValue(elem, `functionName`, DMX.DMXAttributeType.String, null);
    if (functionName === 'emit_continuously')
        return new Emitter_Continuously(elem);

    console.log(`Unknown Emitter`, functionName);
    return null;
}

interface Operator extends ModuleBase {
    run(system: ParticleSystemInstance): void;
}

class Operator_LifespanDecay extends OperatorBase {
    public override streamRead(): StreamMask {
        return StreamMask.SpawnTime | StreamMask.Lifetime;
    }

    public run(system: ParticleSystemInstance): void {
        const data = system.particleDataF32, stride = system.dataStride;
        let lifetimeOffs = system.getStreamOffs(StreamMask.Lifetime);
        let spawnTimeOffs = system.getStreamOffs(StreamMask.SpawnTime);
        for (let p = 0; p < system.getNum(); p++) {
            const endTime = data[spawnTimeOffs] + data[lifetimeOffs];
            if (system.curTime >= endTime)
                system.deadParticle(p);
            lifetimeOffs += stride;
            spawnTimeOffs += stride;
        }
    }
}

class Operator_MovementBasic extends OperatorBase {
    private readonly gravity: ReadonlyVec3;
    private readonly drag: number;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.gravity = getAttribValue(elem, `gravity`, DMX.DMXAttributeType.Vector3, Vec3Zero);
        this.drag = 1.0 - getAttribValue(elem, `drag`, DMX.DMXAttributeType.Float, 0.0);
    }

    public override streamRead(): StreamMask {
        return StreamMask.Position | StreamMask.PrevPosition;
    }

    public override streamWrite(): StreamMask {
        return StreamMask.Position | StreamMask.PrevPosition;
    }

    public run(system: ParticleSystemInstance): void {
        const data = system.particleDataF32, stride = system.dataStride;
        let posOffs = system.getStreamOffs(StreamMask.Position);
        let prevPosOffs = system.getStreamOffs(StreamMask.PrevPosition);
        const dt = system.deltaTime;

        // TODO: forces
        vec3.scale(scratchVec3a, this.gravity, dt ** 2.0);

        for (let p = 0; p < system.getNum(); p++) {
            for (let i = 0; i < 3; i++) {
                const speed = data[posOffs + i] - data[prevPosOffs + i];
                data[prevPosOffs + i] = data[posOffs + i];
                data[posOffs + i] += (speed + scratchVec3a[i]) * this.drag;
            }
            posOffs += stride;
            prevPosOffs += stride;
        }

        // TODO: constraints
    }
}

class Operator_AlphaFadeInRandom extends OperatorBase {
    private readonly fadeInTimeMin: number;
    private readonly fadeInTimeMax: number;
    private readonly fadeInTimeExponent: number;
    private readonly proportional: boolean;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.fadeInTimeMin = getAttribValue(elem, `fade in time min`, DMX.DMXAttributeType.Float, 0.25);
        this.fadeInTimeMax = getAttribValue(elem, `fade in time max`, DMX.DMXAttributeType.Float, 0.25);
        this.fadeInTimeExponent = getAttribValue(elem, `fade in time exponent`, DMX.DMXAttributeType.Float, 1.0);
        this.proportional = getAttribValue(elem, `proportional 0/1`, DMX.DMXAttributeType.Bool, true);
    }

    public override streamRead(): StreamMask {
        let mask = StreamMask.SpawnTime | StreamMask.ParticleID;
        if (this.proportional)
            mask |= StreamMask.Lifetime;
        return mask;
    }

    public override streamWrite(): StreamMask {
        return StreamMask.Alpha;
    }

    public override streamReadInit(): StreamMask {
        return StreamMask.Alpha;
    }

    public run(system: ParticleSystemInstance): void {
        const data = system.particleDataF32, dataInit = system.particleDataInitF32, stride = system.dataStride, strideInit = system.dataInitStride;
        let spawnTimeOffs = system.getStreamOffs(StreamMask.SpawnTime);
        let lifetimeOffs = this.proportional ? system.getStreamOffs(StreamMask.Lifetime) : 0;
        let alphaOffs = system.getStreamOffs(StreamMask.Alpha);
        let alphaInitOffs = system.getStreamInitOffs(StreamMask.Alpha);

        for (let p = 0; p < system.getNum(); p++, lifetimeOffs += stride, spawnTimeOffs += stride, alphaOffs += stride, alphaInitOffs += strideInit) {
            // const fadeInTimeStart = 0;
            const fadeInTimeEnd = randRangeExpOp(system, p, 0, this.fadeInTimeMin, this.fadeInTimeMax, this.fadeInTimeExponent);

            let t = system.curTime - data[spawnTimeOffs];
            if (this.proportional)
                t /= data[lifetimeOffs];

            if (t >= fadeInTimeEnd)
                continue;

            t /= fadeInTimeEnd; // t = invlerp(fadeInTimeStart, fadeInTimeEnd, t);
            data[alphaOffs] = dataInit[alphaInitOffs] * saturate(smoothstep(t));
        }
    }
}

class Operator_AlphaFadeOutRandom extends OperatorBase {
    private readonly fadeOutTimeMin: number;
    private readonly fadeOutTimeMax: number;
    private readonly fadeOutTimeExponent: number;
    private readonly proportional: boolean;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.fadeOutTimeMin = getAttribValue(elem, `fade out time min`, DMX.DMXAttributeType.Float, 0.25);
        this.fadeOutTimeMax = getAttribValue(elem, `fade out time max`, DMX.DMXAttributeType.Float, 0.25);
        this.fadeOutTimeExponent = getAttribValue(elem, `fade out time exponent`, DMX.DMXAttributeType.Float, 1.0);
        this.proportional = getAttribValue(elem, `proportional 0/1`, DMX.DMXAttributeType.Bool, true);
    }

    public override streamRead(): StreamMask {
        return StreamMask.SpawnTime | StreamMask.Lifetime | StreamMask.ParticleID;
    }

    public override streamWrite(): StreamMask {
        return StreamMask.Alpha;
    }

    public override streamReadInit(): StreamMask {
        return StreamMask.Alpha;
    }

    public run(system: ParticleSystemInstance): void {
        const data = system.particleDataF32, dataInit = system.particleDataInitF32, stride = system.dataStride, strideInit = system.dataInitStride;
        let spawnTimeOffs = system.getStreamOffs(StreamMask.SpawnTime);
        let lifetimeOffs = system.getStreamOffs(StreamMask.Lifetime);
        let alphaOffs = system.getStreamOffs(StreamMask.Alpha);
        let alphaInitOffs = system.getStreamInitOffs(StreamMask.Alpha);

        for (let p = 0; p < system.getNum(); p++, lifetimeOffs += stride, spawnTimeOffs += stride, alphaOffs += stride, alphaInitOffs += strideInit) {
            const fadeOutTimeStart = randRangeExpOp(system, p, 0, this.fadeOutTimeMin, this.fadeOutTimeMax, this.fadeOutTimeExponent);
            let fadeOutTimeEnd = 0;

            let t = system.curTime - data[spawnTimeOffs];

            if (this.proportional) {
                t /= data[lifetimeOffs];
                fadeOutTimeEnd = 1;
            } else {
                fadeOutTimeEnd = data[lifetimeOffs];
            }

            if (t <= fadeOutTimeStart)
                continue;

            t = saturate(invlerp(fadeOutTimeEnd, fadeOutTimeStart, t));
            data[alphaOffs] = dataInit[alphaInitOffs] * smoothstep(t);
        }
    }
}

class Operator_AlphaFadeInSimple extends OperatorBase {
    private readonly proportionalFadeInTime: number;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.proportionalFadeInTime = getAttribValue(elem, `proportional fade in time`, DMX.DMXAttributeType.Float, 0.25);
    }

    public override streamRead(): StreamMask {
        return StreamMask.SpawnTime | StreamMask.Lifetime;
    }

    public override streamWrite(): StreamMask {
        return StreamMask.Alpha;
    }

    public override streamReadInit(): StreamMask {
        return StreamMask.Alpha;
    }

    public run(system: ParticleSystemInstance): void {
        const data = system.particleDataF32, dataInit = system.particleDataInitF32, stride = system.dataStride, strideInit = system.dataInitStride;
        let spawnTimeOffs = system.getStreamOffs(StreamMask.SpawnTime);
        let lifetimeOffs = system.getStreamOffs(StreamMask.Lifetime);
        let alphaOffs = system.getStreamOffs(StreamMask.Alpha);
        let alphaInitOffs = system.getStreamInitOffs(StreamMask.Alpha);

        // const fadeInTimeStart = 0.0;
        const fadeInTimeEnd = this.proportionalFadeInTime;

        for (let p = 0; p < system.getNum(); p++, lifetimeOffs += stride, spawnTimeOffs += stride, alphaOffs += stride, alphaInitOffs += strideInit) {
            let t = (system.curTime - data[spawnTimeOffs]) / data[lifetimeOffs];
            if (t >= fadeInTimeEnd)
                continue;

            t /= fadeInTimeEnd; // t = invlerp(fadeInTimeStart, fadeInTimeEnd, t);
            data[alphaOffs] = dataInit[alphaInitOffs] * saturate(smoothstep(t));
        }
    }
}

class Operator_AlphaFadeOutSimple extends OperatorBase {
    private readonly proportionalFadeOutTime: number;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.proportionalFadeOutTime = 1.0 - getAttribValue(elem, `proportional fade out time`, DMX.DMXAttributeType.Float, 0.25);
    }

    public override streamRead(): StreamMask {
        return StreamMask.SpawnTime | StreamMask.Lifetime;
    }

    public override streamWrite(): StreamMask {
        return StreamMask.Alpha;
    }

    public override streamReadInit(): StreamMask {
        return StreamMask.Alpha;
    }

    public run(system: ParticleSystemInstance): void {
        const data = system.particleDataF32, dataInit = system.particleDataInitF32, stride = system.dataStride, strideInit = system.dataInitStride;
        let spawnTimeOffs = system.getStreamOffs(StreamMask.SpawnTime);
        let lifetimeOffs = system.getStreamOffs(StreamMask.Lifetime);
        let alphaOffs = system.getStreamOffs(StreamMask.Alpha);
        let alphaInitOffs = system.getStreamInitOffs(StreamMask.Alpha);

        const fadeInTimeStart = 1.0 - this.proportionalFadeOutTime;
        // const fadeInTimeEnd = 1.0;
        const fadeInTimeDuration = this.proportionalFadeOutTime;

        for (let p = 0; p < system.getNum(); p++, lifetimeOffs += stride, spawnTimeOffs += stride, alphaOffs += stride, alphaInitOffs += strideInit) {
            let t = (system.curTime - data[spawnTimeOffs]) / data[lifetimeOffs];
            if (t <= fadeInTimeStart)
                continue;

            t = (t - fadeInTimeStart) / fadeInTimeDuration;  // t = invlerp(fadeInTimeStart, fadeInTimeEnd, t);
            data[alphaOffs] = dataInit[alphaInitOffs] * saturate(smoothstep(1.0 - t));
        }
    }
}

class Operator_AlphaFadeAndDecay extends OperatorBase {
    private readonly startAlpha: number;
    private readonly endAlpha: number;
    private readonly startFadeInTime: number;
    private readonly endFadeInTime: number;
    private readonly startFadeOutTime: number;
    private readonly endFadeOutTime: number;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.startAlpha = getAttribValue(elem, `start_alpha`, DMX.DMXAttributeType.Float, 1.0);
        this.endAlpha = getAttribValue(elem, `end_alpha`, DMX.DMXAttributeType.Float, 0.0);
        this.startFadeInTime = getAttribValue(elem, `start_fade_in_time`, DMX.DMXAttributeType.Float, 0.0);
        this.endFadeInTime = getAttribValue(elem, `end_fade_in_time`, DMX.DMXAttributeType.Float, 0.5);
        this.startFadeOutTime = getAttribValue(elem, `start_fade_out_time`, DMX.DMXAttributeType.Float, 0.5);
        this.endFadeOutTime = getAttribValue(elem, `end_fade_out_time`, DMX.DMXAttributeType.Float, 1.0);
    }

    public override streamReadInit(): StreamMask {
        return StreamMask.Alpha;
    }

    public override streamRead(): StreamMask {
        return StreamMask.SpawnTime | StreamMask.Lifetime;
    }

    public override streamWrite(): StreamMask {
        return StreamMask.Alpha;
    }

    public run(system: ParticleSystemInstance): void {
        const data = system.particleDataF32, dataInit = system.particleDataInitF32, stride = system.dataStride, strideInit = system.dataInitStride;
        let spawnTimeOffs = system.getStreamOffs(StreamMask.SpawnTime);
        let lifetimeOffs = system.getStreamOffs(StreamMask.Lifetime);
        let alphaOffs = system.getStreamOffs(StreamMask.Alpha);
        let alphaInitOffs = system.getStreamInitOffs(StreamMask.Alpha);

        for (let p = 0; p < system.getNum(); p++, lifetimeOffs += stride, spawnTimeOffs += stride, alphaOffs += stride, alphaInitOffs += strideInit) {
            let t = system.curTime - data[spawnTimeOffs];
            const lifetime = data[lifetimeOffs];

            if (t >= lifetime) {
                system.deadParticle(p);
                continue;
            }

            t /= lifetime;

            let alpha = dataInit[alphaInitOffs];
            if (t <= this.endFadeInTime)
                alpha *= lerp(this.startAlpha, 1.0, saturate(smoothstep(invlerp(this.startFadeInTime, this.endFadeInTime, t))));
            if (t >= this.startFadeOutTime)
                alpha *= lerp(1.0, this.endAlpha, saturate(smoothstep(invlerp(this.startFadeOutTime, this.endFadeOutTime, t))));
            data[alphaOffs] = alpha;
        }
    }
}

function schlickBias(t: number, bias: number): number {
    return t / ((((1.0 / bias) - 2.0) * (1.0 - t)) + 1.0);
}

class Operator_RadiusScale extends OperatorBase {
    private readonly startTime: number;
    private readonly endTime: number;
    private readonly radiusStartScale: number;
    private readonly radiusEndScale: number;
    private readonly easeInAndOut: boolean;
    private readonly scaleBias: number;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.startTime = getAttribValue(elem, `start_time`, DMX.DMXAttributeType.Float, 0);
        this.endTime = getAttribValue(elem, `end_time`, DMX.DMXAttributeType.Float, 1);
        this.radiusStartScale = getAttribValue(elem, `radius_start_scale`, DMX.DMXAttributeType.Float, 1);
        this.radiusEndScale = getAttribValue(elem, `radius_end_scale`, DMX.DMXAttributeType.Float, 1);
        this.easeInAndOut = getAttribValue(elem, `ease_in_and_out`, DMX.DMXAttributeType.Bool, false);
        this.scaleBias = getAttribValue(elem, `scale_bias`, DMX.DMXAttributeType.Float, 0.5);
    }

    public override streamRead(): StreamMask {
        return StreamMask.SpawnTime | StreamMask.Lifetime;
    }

    public override streamWrite(): StreamMask {
        return StreamMask.Radius;
    }

    public override streamReadInit(): StreamMask {
        return StreamMask.Radius;
    }

    public run(system: ParticleSystemInstance): void {
        const data = system.particleDataF32, dataInit = system.particleDataInitF32, stride = system.dataStride, strideInit = system.dataInitStride;
        let spawnTimeOffs = system.getStreamOffs(StreamMask.SpawnTime);
        let lifetimeOffs = system.getStreamOffs(StreamMask.Lifetime);
        let radiusOffs = system.getStreamOffs(StreamMask.Radius);
        let radiusInitOffs = system.getStreamInitOffs(StreamMask.Radius);

        for (let p = 0; p < system.getNum(); p++) {
            let t = (system.curTime - data[spawnTimeOffs]) / data[lifetimeOffs];

            t = saturate(invlerp(this.startTime, this.endTime, t));
            if (this.easeInAndOut)
                t = smoothstep(t);
            else if (this.scaleBias !== 0.5)
                t = schlickBias(t, this.scaleBias);

            data[radiusOffs] = lerp(this.radiusStartScale, this.radiusEndScale, t) * dataInit[radiusInitOffs];

            lifetimeOffs += stride;
            spawnTimeOffs += stride;
            radiusOffs += stride;
            radiusInitOffs += strideInit;
        }
    }
}

class Operator_ColorFade extends OperatorBase {
    private readonly colorFade: Color;
    private readonly startTime: number;
    private readonly endTime: number;
    private readonly easeInAndOut: boolean;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.colorFade = getAttribValue(elem, `color_fade`, DMX.DMXAttributeType.Color, White);
        this.startTime = getAttribValue(elem, `fade_start_time`, DMX.DMXAttributeType.Float, 0.0);
        this.endTime = getAttribValue(elem, `fade_end_time`, DMX.DMXAttributeType.Float, 1.0);
        this.easeInAndOut = getAttribValue(elem, `ease_in_and_out`, DMX.DMXAttributeType.Bool, true);
    }

    public override streamRead(): StreamMask {
        return StreamMask.SpawnTime | StreamMask.Lifetime;
    }

    public override streamWrite(): StreamMask {
        return StreamMask.Color;
    }

    public override streamReadInit(): StreamMask {
        return StreamMask.Color;
    }

    public run(system: ParticleSystemInstance): void {
        const data = system.particleDataF32, dataInit = system.particleDataInitF32, stride = system.dataStride, strideInit = system.dataInitStride;
        let spawnTimeOffs = system.getStreamOffs(StreamMask.SpawnTime);
        let lifetimeOffs = system.getStreamOffs(StreamMask.Lifetime);
        let colorOffs = system.getStreamOffs(StreamMask.Color);
        let colorInitOffs = system.getStreamInitOffs(StreamMask.Color);

        for (let p = 0; p < system.getNum(); p++) {
            let t = (system.curTime - data[spawnTimeOffs]) / data[lifetimeOffs];

            t = saturate(invlerp(this.startTime, this.endTime, t));
            if (this.easeInAndOut)
                t = smoothstep(t);

            data[colorOffs + 0] = lerp(dataInit[colorInitOffs + 0], this.colorFade.r, t);
            data[colorOffs + 1] = lerp(dataInit[colorInitOffs + 1], this.colorFade.g, t);
            data[colorOffs + 2] = lerp(dataInit[colorInitOffs + 2], this.colorFade.b, t);

            lifetimeOffs += stride;
            spawnTimeOffs += stride;
            colorOffs += stride;
            colorInitOffs += strideInit;
        }
    }
}

function createOperator(elem: DMX.DMXElement): Operator | null {
    const functionName = getAttribValue(elem, `functionName`, DMX.DMXAttributeType.String, null);
    if (functionName === `Lifespan Decay`)
        return new Operator_LifespanDecay(elem);
    else if (functionName === `Movement Basic`)
        return new Operator_MovementBasic(elem);
    else if (functionName === `Alpha Fade In Random`)
        return new Operator_AlphaFadeInRandom(elem);
    else if (functionName === `Alpha Fade Out Random`)
        return new Operator_AlphaFadeOutRandom(elem);
    else if (functionName === `Alpha Fade In Simple`)
        return new Operator_AlphaFadeInSimple(elem);
    else if (functionName === `Alpha Fade Out Simple`)
        return new Operator_AlphaFadeOutSimple(elem);
    else if (functionName === `Alpha Fade and Decay`)
        return new Operator_AlphaFadeAndDecay(elem);
    else if (functionName === `Radius Scale`)
        return new Operator_RadiusScale(elem);
    else if (functionName === `Color Fade`)
        return new Operator_ColorFade(elem);

    console.log(`Unknown Operator`, functionName);
    return null;
}

interface Renderer extends ModuleBase {
    prepareToRender(system: ParticleSystemInstance, renderContext: SourceRenderContext, renderInst: GfxRenderInstManager): void;
}

interface SheetFrame {
    coords: ReadonlyVec4[]; // u0, v0, u1, v1
    duration: number;
}

interface SheetSequence {
    clamp: boolean;
    duration: number;
    frames: SheetFrame[];
}

function calcScaleBiasFromCoord(dst: vec4, c: ReadonlyVec4) {
    dst[0] = c[2] - c[0];
    dst[1] = c[3] - c[1];
    dst[2] = c[0];
    dst[3] = c[1];
}

class Sheet {
    public sequence: SheetSequence[] = [];

    constructor(buffer: ArrayBufferSlice) {
        const view = buffer.createDataView();
        const version = view.getUint32(0x00, true);
        assert(version === 0 || version === 1);
        const numCoordsPerFrame = (version === 1) ? 4 : 1;

        const sequenceCount = view.getUint32(0x04, true);
        let offs = 0x08;
        for (let i = 0; i < sequenceCount; i++) {
            const sequenceNo = view.getUint32(offs, true);
            offs += 0x04;
            const clamp = view.getUint32(offs, true) !== 0;
            offs += 0x04;
            const frameCount = view.getUint32(offs, true);
            offs += 0x04;

            const duration = view.getFloat32(offs, true);
            offs += 0x04;

            const frames: SheetFrame[] = [];
            for (let i = 0; i < frameCount; i++) {
                const duration = view.getFloat32(offs, true);
                offs += 0x04;

                const coords: ReadonlyVec4[] = [];
                for (let j = 0; j < numCoordsPerFrame; j++) {
                    const u0 = view.getFloat32(offs + 0x00, true);
                    const v0 = view.getFloat32(offs + 0x04, true);
                    const u1 = view.getFloat32(offs + 0x08, true);
                    const v1 = view.getFloat32(offs + 0x0C, true);
                    coords.push(vec4.fromValues(u0, v0, u1, v1));
                    offs += 0x10;
                }

                frames.push({ duration, coords });
            }

            this.sequence[sequenceNo] = { clamp, duration, frames };
        }
    }

    public calcScaleBias(dst0: vec4, dst1: vec4, sequenceNo: number, coord: number, time: number): number {
        const seq = assertExists(this.sequence[sequenceNo]);
        time = time % seq.duration;
        let t0 = 0;
        for (let i = 0; i < seq.frames.length; i++) {
            let f0 = seq.frames[i], f1 = seq.frames[i + 1];
            if (f1 === undefined) {
                if (seq.clamp) {
                    calcScaleBiasFromCoord(dst0, f0.coords[coord]);
                    vec4.copy(dst1, dst0);
                    return 0.0;
                } else {
                    f1 = seq.frames[0];
                }
            } else {
                const t1 = t0 + f0.duration;
                if (time >= t1) {
                    t0 = t1;
                    continue;
                }
            }

            calcScaleBiasFromCoord(dst0, f0.coords[coord]);
            calcScaleBiasFromCoord(dst1, f1.coords[coord]);
            return (time - t0) / f0.duration;
        }
        throw "whoops";
    }
}

class Renderer_AnimatedSprites extends ModuleBase {
    private readonly animationRate: number;
    private readonly orientationType: number;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.animationRate = getAttribValue(elem, `animation rate`, DMX.DMXAttributeType.Float, 1.0);
        this.orientationType = getAttribValue(elem, `orientation_type`, DMX.DMXAttributeType.Int, 0);
    }

    public override streamRead(): StreamMask {
        return StreamMask.Position | StreamMask.SpawnTime;
    }

    public override streamReadOptional(): StreamMask {
        return StreamMask.Rotation | StreamMask.Radius | StreamMask.Color | StreamMask.Alpha | StreamMask.SequenceNum | StreamMask.SequenceNum2;
    }

    public prepareToRender(system: ParticleSystemInstance, renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager): void {
        // TODO(jstpierre): Do this all in one draw call

        const materialInstance = system.materialInstance!;
        const sheet = system.getSheet();

        const view = renderContext.currentView;
        const staticQuad = renderContext.materialCache.staticResources.staticQuad;

        const template = renderInstManager.pushTemplateRenderInst();
        staticQuad.setQuadOnRenderInst(template);

        if (this.orientationType === 2) {
            computeMatrixForForwardDir(scratchMat4b, Vec3UnitZ, Vec3Zero);
        } else {
            getMatrixAxisZ(scratchVec3a, view.worldFromViewMatrix);
            computeMatrixForForwardDir(scratchMat4b, scratchVec3a, Vec3Zero);
        }

        const isSpriteCard = (materialInstance as any).isSpriteCard;

        const data = system.particleDataF32, stride = system.dataStride;
        const curTime = system.curTime;
        let posOffs = system.getStreamOffs(StreamMask.Position);
        let spawnTimeOffs = system.getStreamOffs(StreamMask.SpawnTime);
        let radiusOffs = system.hasStream(StreamMask.Radius) ? system.getStreamOffs(StreamMask.Radius) : null;
        let rotationOffs = system.hasStream(StreamMask.Rotation) ? system.getStreamOffs(StreamMask.Rotation) : null;
        let colorOffs = system.hasStream(StreamMask.Color) ? system.getStreamOffs(StreamMask.Color) : null;
        let alphaOffs = system.hasStream(StreamMask.Alpha) ? system.getStreamOffs(StreamMask.Alpha) : null;
        let sequenceNumOffs = system.hasStream(StreamMask.SequenceNum) ? system.getStreamOffs(StreamMask.SequenceNum) : null;
        let sequenceNum2Offs = system.hasStream(StreamMask.SequenceNum2) ? system.getStreamOffs(StreamMask.SequenceNum2) : null;

        for (let p = 0; p < system.getNum(); p++) {
            let rotation: number;
            if (rotationOffs !== null) {
                rotation = data[rotationOffs];
                rotationOffs += stride;
            } else {
                rotation = system.constRotation;
            }

            if (rotation !== 0) {
                computeModelMatrixR(scratchMat4a, rotation, 0, 0);
                mat4.mul(scratchMat4a, scratchMat4b, scratchMat4a);
            } else {
                mat4.copy(scratchMat4a, scratchMat4b);
            }

            let radius: number;
            if (radiusOffs !== null) {
                radius = data[radiusOffs];
                radiusOffs += stride;
            } else {
                radius = system.constRadius;
            }

            scaleMatrix(scratchMat4a, scratchMat4a, radius);

            if (colorOffs !== null) {
                const p = (materialInstance.param['$color'] as any).internal;
                p[0].value = data[colorOffs + 0];
                p[1].value = data[colorOffs + 1];
                p[2].value = data[colorOffs + 2];
                colorOffs += stride;
            } else {
                const p = (materialInstance.param['$color'] as any).internal;
                p[0].value = system.constColor.r;
                p[1].value = system.constColor.g;
                p[2].value = system.constColor.b;
            }

            if (alphaOffs !== null) {
                materialInstance.paramSetNumber('$alpha', data[alphaOffs]);
                alphaOffs += stride;
            } else {
                materialInstance.paramSetNumber('$alpha', system.constColor.a);
            }

            let sequenceNum: number;
            if (sequenceNumOffs !== null) {
                sequenceNum = data[sequenceNumOffs];
                sequenceNumOffs += stride;
            } else {
                sequenceNum = system.constSequenceNum;
            }

            let sequenceNum2: number;
            if (sequenceNum2Offs !== null) {
                sequenceNum2 = data[sequenceNum2Offs];
                sequenceNum2Offs += stride;
            } else {
                sequenceNum2 = system.constSequenceNum2;
            }

            if (isSpriteCard) {
                const time = this.animationRate * (curTime - data[spawnTimeOffs]);
                let blend: number;

                // Sequence Num 1
                if (sheet !== null) {
                    blend = sheet.calcScaleBias(scratchVec4a, scratchVec4b, sequenceNum, 0, time);
                } else {
                    vec4.set(scratchVec4a, 1.0, 1.0, 0.0, 0.0);
                    vec4.set(scratchVec4b, 1.0, 1.0, 0.0, 0.0);
                    blend = 0.0;
                }

                materialInstance.paramSetNumber('_blend0', blend);
                (materialInstance.param['_b00'] as any).setArray(scratchVec4a);
                (materialInstance.param['_b01'] as any).setArray(scratchVec4b);

                // Sequence Num 2
                if (sheet !== null) {
                    blend = sheet.calcScaleBias(scratchVec4a, scratchVec4b, sequenceNum2, 0, time);
                } else {
                    vec4.set(scratchVec4a, 1.0, 1.0, 0.0, 0.0);
                    vec4.set(scratchVec4b, 1.0, 1.0, 0.0, 0.0);
                    blend = 0.0;
                }

                materialInstance.paramSetNumber('_blend1', blend);
                (materialInstance.param['_b10'] as any).setArray(scratchVec4a);
                (materialInstance.param['_b11'] as any).setArray(scratchVec4b);
            }

            vec3.set(scratchVec3a, data[posOffs + 0], data[posOffs + 1], data[posOffs + 2]);
            posOffs += stride;
            spawnTimeOffs += stride;

            if (!renderContext.currentView.frustum.containsSphere(scratchVec3a, radius))
                continue;

            setMatrixTranslation(scratchMat4a, scratchVec3a);

            const renderInst = renderInstManager.newRenderInst();
            materialInstance.setOnRenderInstModelMatrix(renderInst, scratchMat4a);

            materialInstance.setOnRenderInst(renderContext, renderInst);

            const depth = computeViewSpaceDepthFromWorldSpacePoint(view.viewFromWorldMatrix, scratchVec3a);
            renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);

            materialInstance.getRenderInstListForView(view).submitRenderInst(renderInst);
        }

        renderInstManager.popTemplateRenderInst();
    }
}

function createRenderer(elem: DMX.DMXElement): Renderer | null {
    const functionName = getAttribValue(elem, `functionName`, DMX.DMXAttributeType.String, null);
    if (functionName === 'render_animated_sprites')
        return new Renderer_AnimatedSprites(elem);

    console.log('Unknown Renderer', functionName);
    return null;
}

export class ParticleControlPoint {
    public transform = mat4.create();
    public prevTransform = mat4.create();
}

interface Controller {
    controlPoints: ParticleControlPoint[];
}

export class ParticleSystemInstance {
    // System definition stuff (can be cached if desired)
    public materialInstance: BaseMaterial | null = null;
    private sheet: Sheet | null | undefined = undefined;
    private readonly operators: Operator[] = [];
    private readonly initializers: Initializer[] = [];

    private readonly streamMask: StreamMask = 0;
    private readonly streamConstMask: StreamMask = 0;
    public readonly dataStride: number = 0;
    private readonly dataStreamOffs: number[] = [];
    private readonly streamInitMask: StreamMask = 0;
    public readonly dataInitStride: number = 0;
    private readonly dataInitStreamOffs: number[] = [];
    private readonly bbox: AABB;

    // Constant values.
    public readonly constRadius: number;
    public readonly constColor: Color;
    public readonly constRotation: number;
    public readonly constSequenceNum: number;
    public readonly constSequenceNum2: number;

    // Instance stuff
    public curTime: number = 0;
    public deltaTime: number = 0;

    public readonly particleDataF32: Float32Array;
    public readonly particleDataInitF32: Float32Array;
    public particleNextID = 0;
    private particleNum = 0;
    private particleMax = 0;
    private emitters: Emitter[] = [];
    private renderers: Renderer[] = [];
    private children: ParticleSystemInstance[] = [];
    private deadParticleList: number[] = [];
    private random: SeededRNG;
    private randF32OpPool = new Float32Array(0x800);
    private randF32OpCounter = 0;
    private visible = true;
    public emitActive = true;

    constructor(private renderContext: SourceRenderContext, def: DMX.DMXElement, private controller: Controller) {
        this.particleMax = getAttribValue(def, `max_particles`, DMX.DMXAttributeType.Int, 1000);

        const bboxMin = getAttribValue(def, `bounding_box_min`, DMX.DMXAttributeType.Vector3, Vec3Zero);
        const bboxMax = getAttribValue(def, `bounding_box_max`, DMX.DMXAttributeType.Vector3, Vec3Zero);
        this.bbox = new AABB(bboxMin[0], bboxMin[1], bboxMin[2], bboxMax[0], bboxMax[1], bboxMax[2]);

        let streamWrite = StreamMask.None;
        let streamWriteInit = StreamMask.None;
        let streamRead = StreamMask.None;
        let streamReadInit = StreamMask.None;
        let streamReadOptional = StreamMask.None;

        const renderers = getAttribValue(def, `renderers`, DMX.DMXAttributeType.ElementArray, null);
        for (let i = 0; i < renderers.length; i++) {
            const mod = createRenderer(renderers[i]);
            if (mod === null)
                continue;
            streamWrite |= mod.streamWrite();
            streamRead |= mod.streamRead();
            streamReadInit |= mod.streamReadInit();
            streamReadOptional |= mod.streamReadOptional();
            this.renderers.push(mod);
        }

        const operators = getAttribValue(def, `operators`, DMX.DMXAttributeType.ElementArray, null);
        for (let i = 0; i < operators.length; i++) {
            const mod = createOperator(operators[i]);
            if (mod === null)
                continue;
            streamWrite |= mod.streamWrite();
            streamRead |= mod.streamRead();
            streamReadInit |= mod.streamReadInit();
            streamReadOptional |= mod.streamReadOptional();
            this.operators.push(mod);
        }

        const initializers = getAttribValue(def, `initializers`, DMX.DMXAttributeType.ElementArray, null);
        for (let i = 0; i < initializers.length; i++) {
            const mod = createInitializer(initializers[i]);
            if (mod === null)
                continue;
            streamWrite |= mod.streamWrite();
            streamWriteInit |= mod.streamWrite();
            streamRead |= mod.streamRead();
            streamReadInit |= mod.streamReadInit();
            streamReadOptional |= mod.streamReadOptional();
            this.initializers.push(mod);
        }

        const emitters = getAttribValue(def, `emitters`, DMX.DMXAttributeType.ElementArray, null);
        for (let i = 0; i < emitters.length; i++) {
            const mod = createEmitter(emitters[i]);
            if (mod === null)
                continue;
            streamWrite |= mod.streamWrite();
            streamWriteInit |= mod.streamWrite();
            streamRead |= mod.streamRead();
            streamReadInit |= mod.streamReadInit();
            streamReadOptional |= mod.streamReadOptional();
            this.emitters.push(mod);
        }

        const children = getAttribValue(def, `children`, DMX.DMXAttributeType.ElementArray, null);
        for (let i = 0; i < children.length; i++) {
            const delay = getAttribValue(children[i], `delay`, DMX.DMXAttributeType.Float, 0);
            const child = getAttribValue(children[i], `child`, DMX.DMXAttributeType.Element, null);

            const childSystem = new ParticleSystemInstance(renderContext, child, this.controller);
            childSystem.initChild(this, delay);
            this.children.push(childSystem);
        }

        // Debug draw
        if (this.renderers.length === 0)
            streamReadOptional |= (streamWrite & (StreamMask.Color | StreamMask.Alpha | StreamMask.Radius));

        // Any stream that doesn't get written to by an initializer/emitter needs a constant init...
        this.streamConstMask = (streamRead & ~streamWriteInit) >>> 0;

        // Start with all the streams that are required...
        this.streamMask = streamRead;

        // Include any optional streams we have writers for.
        this.streamMask |= (streamReadOptional & (streamWrite | streamWriteInit));

        let streamBits = this.streamMask;
        while (streamBits !== 0) {
            const stream = streamBits & -streamBits;
            const streamStride = getStreamStride(stream);
            this.dataStreamOffs[Math.log2(stream) | 0] = this.dataStride;
            this.dataStride += streamStride;
            streamBits &= ~stream;
        }

        this.streamInitMask = streamReadInit;

        let streamInitBits = this.streamInitMask;
        while (streamInitBits !== 0) {
            const stream = streamInitBits & -streamInitBits;
            const streamStride = getStreamStride(stream);
            this.dataInitStreamOffs[Math.log2(stream) | 0] = this.dataInitStride;
            this.dataInitStride += streamStride;
            streamInitBits &= ~stream;
        }

        // Initialize dynamic data
        // TODO(jstpierre): We can put this in one array...
        this.particleDataF32 = new Float32Array(this.dataStride * this.particleMax);
        this.particleDataInitF32 = new Float32Array(this.dataInitStride * this.particleMax);

        // Initialize constant data
        this.constRadius = getAttribValue(def, `radius`, DMX.DMXAttributeType.Float, 5);
        this.constColor = getAttribValue(def, `color`, DMX.DMXAttributeType.Color, White);
        this.constRotation = getAttribValue(def, `radius`, DMX.DMXAttributeType.Float, 0) * MathConstants.DEG_TO_RAD;
        this.constSequenceNum = getAttribValue(def, `sequence_number`, DMX.DMXAttributeType.Int, 0);
        this.constSequenceNum2 = getAttribValue(def, `sequence_number 1`, DMX.DMXAttributeType.Int, 0);

        const materialName = getAttribValue(def, 'material', DMX.DMXAttributeType.String, null);
        this.initMaterial(materialName);

        // Set up randoms.
        this.random = new SeededRNG();
        this.random.seedRandom();

        for (let i = 0; i < 0x800; i++)
            this.randF32OpPool[i] = Math.random();
    }

    public initChild(parent: ParticleSystemInstance, delay: number): void {
        this.curTime = -delay;
    }

    public isEmitActive(): boolean {
        if (!this.emitActive)
            return false;

        for (let i = 0; i < this.emitters.length; i++)
            if (this.emitters[i].isEmitActive(this))
                return true;

        return false;
    }

    public isFinished(): boolean {
        if (this.isEmitActive())
            return false;

        if (this.particleNum > 0)
            return false;

        for (let i = 0; i < this.children.length; i++)
            if (!this.children[i].isFinished())
                return false;

        return true;
    }

    public getControlPointTransform(dst: mat4, i: number, time: number): void {
        const point = this.controller.controlPoints[i];
        // TODO(jstpierre): time lerp
        mat4.copy(dst, point.transform);
    }

    public randF32(): number {
        return this.random.nextF32();
    }

    public randF32Op(p: number, o: number): number {
        const particleID = this.particleDataF32[this.getStreamOffs(StreamMask.ParticleID, p)];
        return this.randF32OpPool[(this.randF32OpCounter + particleID + o) & 0x7FF];
    }

    public hasStream(stream: StreamMask): boolean {
        return !!(this.streamMask & stream);
    }

    public getStreamOffs(stream: StreamMask, p: number = 0): number {
        assert(this.hasStream(stream));
        return this.dataStride * p + this.dataStreamOffs[Math.log2(stream) | 0];
    }

    public getStreamInitOffs(stream: StreamMask, p: number = 0): number {
        assert(!!(this.streamInitMask & stream));
        return this.dataInitStride * p + this.dataInitStreamOffs[Math.log2(stream) | 0];
    }

    public getNum(): number {
        return this.particleNum;
    }

    private createSheet(materialInstance: BaseMaterial): Sheet | null {
        const texture = materialInstance.representativeTexture;
        if (texture === null)
            return null;

        for (let i = 0; i < texture.resources.length; i++)
            if (texture.resources[i].rsrcID === 0x10000000) // VTF_RSRC_SHEET
                return new Sheet(texture.resources[i].data);
        return null;
    }

    public getSheet(): Sheet | null {
        if (this.sheet === undefined) {
            if (this.materialInstance === null)
                return null;

            this.sheet = this.createSheet(this.materialInstance);
        }

        return this.sheet;
    }

    public async initMaterial(materialName: string) {
        const materialInstance = await this.renderContext.materialCache.createMaterialInstance(materialName);
        await materialInstance.init(this.renderContext);
        this.materialInstance = materialInstance;
    }

    public createParticles(num: number): number {
        const numToCreate = Math.min(this.particleMax - this.particleNum, num);
        const index = this.particleNum;
        this.particleNum += numToCreate;
        return index;
    }

    private emit(): void {
        if (!this.emitActive)
            return;

        const oldParticleNum = this.particleNum;
        let srcOffs = oldParticleNum * this.dataStride, dstOffs = oldParticleNum * this.dataInitStride;

        for (let i = 0; i < this.emitters.length; i++)
            this.emitters[i].emit(this);

        for (let p = oldParticleNum; p < this.particleNum; p++) {
            for (let i = 0; i < this.initializers.length; i++)
                this.initializers[i].init(this, p);

            let streamConstBits = this.streamConstMask;
            while (streamConstBits !== 0) {
                const stream = streamConstBits & -streamConstBits;
                let offs = p * this.dataStride + this.dataStreamOffs[Math.log2(stream) | 0];
                if (stream === StreamMask.Lifetime) {
                    this.particleDataF32[offs] = 1.0;
                } else if (stream === StreamMask.Color) {
                    this.particleDataF32[offs++] = this.constColor.r;
                    this.particleDataF32[offs++] = this.constColor.g;
                    this.particleDataF32[offs++] = this.constColor.b;
                } else if (stream === StreamMask.Alpha) {
                    this.particleDataF32[offs] = this.constColor.a;
                } else if (stream === StreamMask.Radius) {
                    this.particleDataF32[offs] = this.constRadius;
                } else {
                    throw "whoops";
                }
                streamConstBits &= ~stream;
            }

            let streamInitBits = this.streamInitMask;
            while (streamInitBits !== 0) {
                const stream = streamInitBits & -streamInitBits;
                const streamStride = getStreamStride(stream);
                const offsIdx = Math.log2(stream) | 0;
                let srcIdx = srcOffs + this.dataStreamOffs[offsIdx], dstIdx = dstOffs + this.dataInitStreamOffs[offsIdx];
                for (let i = 0; i < streamStride; i++)
                    this.particleDataInitF32[dstIdx++] = this.particleDataF32[srcIdx++];
                streamInitBits &= ~stream;
            }

            srcOffs += this.dataStride;
            dstOffs += this.dataInitStride;
        }
    }

    public deadParticle(p: number): void {
        // ensure sorted
        if (this.deadParticleList.length !== 0)
            assert(this.deadParticleList[this.deadParticleList.length - 1] <= p);

        this.deadParticleList.push(p);
    }

    private operate(): void {
        this.randF32OpCounter = 0;

        for (let i = 0; i < this.operators.length; i++) {
            this.operators[i].run(this);

            if (this.deadParticleList.length > 0) {
                // TODO(jstpierre): Do we need to maintain in-order?
                let offs = 0;
                for (let i = 0; i < this.deadParticleList.length; i++) {
                    const dstIdx = this.deadParticleList[i] + offs--, srcIdx = --this.particleNum;
                    this.particleDataF32.copyWithin(this.dataStride * dstIdx, this.dataStride * srcIdx, this.dataStride * srcIdx + this.dataStride);
                    this.particleDataInitF32.copyWithin(this.dataInitStride * dstIdx, this.dataInitStride * srcIdx, this.dataInitStride * srcIdx + this.dataInitStride);
                }

                this.deadParticleList.length = 0;
            }

            this.randF32OpCounter += 17;
        }
    }

    public movement(renderContext: SourceRenderContext): void {
        this.deltaTime = renderContext.globalDeltaTime;
        if (this.deltaTime <= 0.001)
            return;

        // Clamp to a somewhat reasonable value...
        if (this.deltaTime >= 0.3)
            this.deltaTime = 0.3;

        this.curTime += this.deltaTime;
        if (this.curTime <= 0)
            return;

        this.emit();
        this.operate();

        for (let i = 0; i < this.children.length; i++)
            this.children[i].movement(renderContext);
    }

    private debugDraw(renderContext: SourceRenderContext): void {
        if (!IS_DEVELOPMENT)
            return;

        if (renderContext.currentView.viewType === SourceEngineViewType.WaterReflectView)
            return;

        const ctx = getDebugOverlayCanvas2D();

        const data = this.particleDataF32;
        const scratchColor = colorNewCopy(Magenta);

        for (let p = 0; p < this.particleNum; p++) {
            const posOffs = this.getStreamOffs(StreamMask.Position, p);
            vec3.set(scratchVec3a, data[posOffs + 0],data[posOffs + 1], data[posOffs + 2]);

            if (this.hasStream(StreamMask.Color)) {
                const colorOffs = this.getStreamOffs(StreamMask.Color, p);
                scratchColor.r = data[colorOffs + 0];
                scratchColor.g = data[colorOffs + 1];
                scratchColor.b = data[colorOffs + 2];
            }

            if (this.hasStream(StreamMask.Alpha))
                scratchColor.a = data[this.getStreamOffs(StreamMask.Alpha, p)];

            let radius = 12;
            if (this.hasStream(StreamMask.Radius))
                radius = data[this.getStreamOffs(StreamMask.Radius, p)];

            drawWorldSpacePoint(ctx, renderContext.currentView.clipFromWorldMatrix, scratchVec3a, scratchColor, radius);
        }
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager): void {
        if (!this.visible || this.materialInstance === null)
            return;

        for (let i = 0; i < this.renderers.length; i++)
            this.renderers[i].prepareToRender(this, renderContext, renderInstManager);

        if (this.renderers.length === 0)
            this.debugDraw(renderContext);

        for (let i = 0; i < this.children.length; i++)
            this.children[i].prepareToRender(renderContext, renderInstManager);
    }

    public destroy(device: GfxDevice): void {
        // Nothing yet.
    }
}

export class ParticleSystemCache {
    private systemDefinitions: DMX.DMXElement[] = [];
    public isLoaded = false;

    constructor(filesystem: SourceFileSystem) {
        this.fetchManifest(filesystem);
    }

    public getParticleSystemDefinition(name: string): DMX.DMXElement | null {
        for (let i = 0; i < this.systemDefinitions.length; i++)
            if (this.systemDefinitions[i].name === name)
                return this.systemDefinitions[i];
        return null;
    }

    private async fetchManifest(filesystem: SourceFileSystem) {
        const manifestData = await filesystem.fetchFileData(`particles/particles_manifest.txt`);
        if (manifestData === null) {
            this.isLoaded = true;
            return;
        }

        const manifestStr = new TextDecoder('utf8').decode(manifestData.createTypedArray(Uint8Array));
        const root = new ValveKeyValueParser(manifestStr).pair();
        assert(root[0] === 'particles_manifest');

        const list = root[1] as VKFPair[];

        const promises = [];
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            assert(item[0] === 'file');

            let filename = item[1] as string;
            if (filename.startsWith('!'))
                filename = filename.slice(1);

            promises.push(this.fetchSystem(filesystem, filename));
        }

        await Promise.all(promises);
        this.isLoaded = true;
    }

    private async fetchSystem(filesystem: SourceFileSystem, filename: string) {
        const dmx = await filesystem.fetchFileData(filename);
        if (dmx === null)
            return;

        const dmxData = DMX.parse(dmx);

        const systemDefs = getAttribValue(dmxData.rootElement, `particleSystemDefinitions`, DMX.DMXAttributeType.ElementArray, null);
        for (let i = 0; i < systemDefs.length; i++)
            this.systemDefinitions.push(systemDefs[i]);
    }
}
