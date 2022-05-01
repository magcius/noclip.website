
import { mat4, ReadonlyVec3, vec3 } from "gl-matrix";
import { Color, colorNewCopy, Magenta } from "../Color";
import { drawWorldSpacePoint, getDebugOverlayCanvas2D } from "../DebugJunk";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { invlerp, lerp, saturate, smoothstep, transformVec3Mat4w0, transformVec3Mat4w1, Vec3One } from "../MathHelpers";
import { assert, assertExists } from "../util";
import * as DMX from "./DMX";
import { BaseEntity } from "./EntitySystem";
import { SourceFileSystem, SourceRenderContext } from "./Main";
import { BaseMaterial } from "./Materials";
import { ValveKeyValueParser, VKFPair } from "./VMT";

class SeededRNG {
    private state: number;

    public seedRandom(): void {
        this.state = Math.random();
    }

    public copy(o: SeededRNG) {
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
    T extends DMX.DMXAttributeType.Vector3 ? ReadonlyVec3 :
    T extends DMX.DMXAttributeType.ElementArray ? DMX.DMXElement[] :
    T extends DMX.DMXAttributeType.IntArray ? number[] :
    T extends DMX.DMXAttributeType.FloatArray ? number[] :
    T extends DMX.DMXAttributeType.BoolArray ? boolean[] :
    T extends DMX.DMXAttributeType.StringArray ? string[] :
    T extends DMX.DMXAttributeType.Vector3Array ? ReadonlyVec3[] :
    never;

function getAttribValue<T extends DMX.DMXAttributeType>(elem: DMX.DMXElement, name: string, type: T): DMXType<T> {
    const attrib = assertExists(elem.attributes.find((attrib) => attrib.name === name));
    assert(attrib.type === type);
    return attrib.value as DMXType<T>;
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchMat4a = mat4.create();

const enum StreamMask {
    None        = 0,
    Position    = 1 << 0,
    Lifetime    = 1 << 1,
    Color       = 1 << 2,
    Alpha       = 1 << 3,
    Radius      = 1 << 4,
    TrailLength = 1 << 5,
    SpawnTime   = 1 << 6,
    Speed       = 1 << 7,
}

function getStreamStride(bit: StreamMask): number {
    if (bit === StreamMask.Position)
        return 3;
    else if (bit === StreamMask.Lifetime)
        return 1;
    else if (bit === StreamMask.Color)
        return 3;
    else if (bit === StreamMask.Alpha)
        return 1;
    else if (bit === StreamMask.Radius)
        return 1;
    else if (bit === StreamMask.TrailLength)
        return 1;
    else if (bit === StreamMask.SpawnTime)
        return 1;
    else if (bit === StreamMask.Speed)
        return 3;
    else
        throw "whoops";
}

abstract class ModuleBase {
    private startFadeIn: number;
    private startFadeOut: number;
    private endFadeIn: number;
    private endFadeOut: number;
    private fadeOscillate: number;

    constructor(elem: DMX.DMXElement) {
        this.startFadeIn = getAttribValue(elem, `operator start fadein`, DMX.DMXAttributeType.Float);
        this.endFadeIn = getAttribValue(elem, `operator end fadein`, DMX.DMXAttributeType.Float);
        this.startFadeOut = getAttribValue(elem, `operator start fadeout`, DMX.DMXAttributeType.Float);
        this.endFadeOut = getAttribValue(elem, `operator end fadeout`, DMX.DMXAttributeType.Float);
        this.fadeOscillate = getAttribValue(elem, `operator fade oscillate`, DMX.DMXAttributeType.Float);
    }

    public calcWeight(curTime: number): number {
        if (curTime >= this.startFadeIn && curTime <= this.endFadeIn)
            return invlerp(this.startFadeIn, this.startFadeOut, curTime);
        else if (curTime >= this.startFadeOut && curTime <= this.endFadeOut)
            return invlerp(this.startFadeOut, this.endFadeOut, curTime);
        else
            return 1.0;
    }

    public streamReadInit(): StreamMask {
        return StreamMask.None;
    }

    abstract streamRead(): StreamMask;
    abstract streamWrite(): StreamMask;
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

function randInAABB(dst: vec3, system: ParticleSystemInstance, min: ReadonlyVec3, max: ReadonlyVec3): void {
    for (let i = 0; i < 3; i++) {
        if (min[i] === max[i])
            dst[i] = min[i];
        else
            dst[i] = lerp(min[i], max[i], system.randF32());
    }
}

class Initializer_PositionWithSphereRandom extends ModuleBase {
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
        this.distMin = getAttribValue(elem, `distance_min`, DMX.DMXAttributeType.Float);
        this.distMax = getAttribValue(elem, `distance_max`, DMX.DMXAttributeType.Float);
        this.distBias = getAttribValue(elem, `distance_bias`, DMX.DMXAttributeType.Vector3);
        this.distBiasInLocalCoords = getAttribValue(elem, `bias in local system`, DMX.DMXAttributeType.Bool);
        this.controlPointNo = getAttribValue(elem, `control_point_number`, DMX.DMXAttributeType.Int);
        this.speedMin = getAttribValue(elem, `speed_min`, DMX.DMXAttributeType.Float);
        this.speedMax = getAttribValue(elem, `speed_max`, DMX.DMXAttributeType.Float);
        this.speedInLocalCoordinateSystemMin = getAttribValue(elem, `speed_in_local_coordinate_system_min`, DMX.DMXAttributeType.Vector3);
        this.speedInLocalCoordinateSystemMax = getAttribValue(elem, `speed_in_local_coordinate_system_max`, DMX.DMXAttributeType.Vector3);
    }

    public streamRead(): StreamMask {
        return StreamMask.None;
    }

    public streamWrite(): StreamMask {
        return StreamMask.Position | StreamMask.Speed;
    }

    public init(system: ParticleSystemInstance, p: number): void {
        const data = system.particleDataF32;
        const spawnTime = system.curTime;
        system.getControlPointTransform(scratchMat4a, this.controlPointNo, spawnTime);

        if (system.hasStream(StreamMask.Position)) {
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
        }

        if (system.hasStream(StreamMask.Speed)) {
            const speed = randRangeExp(system, this.speedMin, this.speedMax, this.speedRandomExponent);
            vec3.scale(scratchVec3b, scratchVec3a, speed);

            randInAABB(scratchVec3a, system, this.speedInLocalCoordinateSystemMin, this.speedInLocalCoordinateSystemMax);
            transformVec3Mat4w0(scratchVec3a, scratchMat4a, scratchVec3a);
            vec3.add(scratchVec3b, scratchVec3b, scratchVec3a);

            const speedOffs = system.getStreamOffs(StreamMask.Speed, p);
            data[speedOffs + 0] = scratchVec3b[0];
            data[speedOffs + 1] = scratchVec3b[1];
            data[speedOffs + 2] = scratchVec3b[2];
        }
    }
}

class Initializer_LifetimeRandom extends ModuleBase {
    private readonly min: number;
    private readonly max: number;
    private readonly randomExponent: number;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.min = getAttribValue(elem, `lifetime_min`, DMX.DMXAttributeType.Float);
        this.max = getAttribValue(elem, `lifetime_max`, DMX.DMXAttributeType.Float);
        this.randomExponent = getAttribValue(elem, `lifetime_random_exponent`, DMX.DMXAttributeType.Float);
    }

    public streamRead(): StreamMask {
        return StreamMask.None;
    }

    public streamWrite(): StreamMask {
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
        this.min = getAttribValue(elem, `alpha_min`, DMX.DMXAttributeType.Int) / 255;
        this.max = getAttribValue(elem, `alpha_max`, DMX.DMXAttributeType.Int) / 255;
        this.randomExponent = getAttribValue(elem, `alpha_random_exponent`, DMX.DMXAttributeType.Float);
    }

    public streamRead(): StreamMask {
        return StreamMask.None;
    }

    public streamWrite(): StreamMask {
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
        this.color1 = getAttribValue(elem, `color1`, DMX.DMXAttributeType.Color);
        this.color2 = getAttribValue(elem, `color2`, DMX.DMXAttributeType.Color);
        // TODO(jstpierre): Tint?
    }

    public streamRead(): StreamMask {
        return StreamMask.None;
    }

    public streamWrite(): StreamMask {
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
        this.min = getAttribValue(elem, `radius_min`, DMX.DMXAttributeType.Float);
        this.max = getAttribValue(elem, `radius_max`, DMX.DMXAttributeType.Float);
        this.randomExponent = getAttribValue(elem, `radius_random_exponent`, DMX.DMXAttributeType.Float);
    }

    public streamRead(): StreamMask {
        return StreamMask.None;
    }

    public streamWrite(): StreamMask {
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
        this.min = getAttribValue(elem, `length_min`, DMX.DMXAttributeType.Float);
        this.max = getAttribValue(elem, `length_max`, DMX.DMXAttributeType.Float);
        this.randomExponent = getAttribValue(elem, `length_random_exponent`, DMX.DMXAttributeType.Float);
    }

    public streamRead(): StreamMask {
        return StreamMask.None;
    }

    public streamWrite(): StreamMask {
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
        this.min = getAttribValue(elem, `offset min`, DMX.DMXAttributeType.Vector3);
        this.max = getAttribValue(elem, `offset max`, DMX.DMXAttributeType.Vector3);
        this.inLocalSpace = getAttribValue(elem, `offset in local space 0/1`, DMX.DMXAttributeType.Bool);
        this.proportionalToRadius = getAttribValue(elem, `offset proportional to radius 0/1`, DMX.DMXAttributeType.Bool);
        this.controlPointNo = getAttribValue(elem, `control_point_number`, DMX.DMXAttributeType.Int);
    }

    public streamRead(): StreamMask {
        let mask = StreamMask.Position;
        if (this.proportionalToRadius)
            mask |= StreamMask.Radius;
        // if (this.inLocalSpace)
        //     mask |= StreamMask.SpawnTime;
        return mask;
    }

    public streamWrite(): StreamMask {
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
    }
}

class Initializer_RotationRandom extends ModuleBase {
    private readonly initial: number;
    private readonly min: number;
    private readonly max: number;
    private readonly randomExponent: number;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.initial = getAttribValue(elem, `rotation_initial`, DMX.DMXAttributeType.Float);
        this.min = getAttribValue(elem, `rotation_offset_min`, DMX.DMXAttributeType.Float);
        this.max = getAttribValue(elem, `rotation_offset_max`, DMX.DMXAttributeType.Float);
        this.randomExponent = getAttribValue(elem, `rotation_random_exponent`, DMX.DMXAttributeType.Float);
    }

    public streamRead(): StreamMask {
        return StreamMask.None;
    }

    public streamWrite(): StreamMask {
        return StreamMask.None;
    }

    public init(system: ParticleSystemInstance, p: number): void {
        // TODO(jstpierre): Rotation
        return;
    }
}

function createInitializer(elem: DMX.DMXElement): Initializer {
    const functionName = getAttribValue(elem, `functionName`, DMX.DMXAttributeType.String);
    if (functionName === 'Position Within Sphere Random')
        return new Initializer_PositionWithSphereRandom(elem);
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
    else
        throw "whoops";
}

interface Emitter extends ModuleBase {
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
        this.rate = getAttribValue(elem, `emission_rate`, DMX.DMXAttributeType.Float);
        this.duration = getAttribValue(elem, `emission_duration`, DMX.DMXAttributeType.Float);
        this.startTime = getAttribValue(elem, `emission_start_time`, DMX.DMXAttributeType.Float);
    }

    public streamRead(): StreamMask {
        return StreamMask.None;
    }

    public streamWrite(): StreamMask {
        return StreamMask.SpawnTime;
    }

    public hasDuration(): boolean {
        return this.duration > 0.0;
    }

    public emit(system: ParticleSystemInstance): void {
        const rate = this.rate;
        if (rate <= 0.0)
            return;

        let curTime = system.curTime;
        if (curTime <= this.startTime)
            return;

        let prevTime = curTime - system.deltaTime;
        if (prevTime < this.startTime)
            prevTime = this.startTime;

        if (this.hasDuration()) {
            const endTime = this.startTime + this.duration;
            if (curTime >= endTime)
                return;
        }

        this.emitCounter += (rate * (curTime - prevTime));
        const newEmitNum = (this.emitCounter | 0);
        const numParticlesToEmit = newEmitNum - this.particleEmitNum;
        let p = system.createParticles(numParticlesToEmit), num = system.getNum();
        this.particleEmitNum = newEmitNum;

        if (system.hasStream(StreamMask.SpawnTime)) {
            let spawnTime = prevTime, spawnTimeStep = 1.0 / rate;
            const data = system.particleDataF32, stride = system.dataStride;
            let offs = system.getStreamOffs(StreamMask.SpawnTime, p);
            for (; p < num; p++) {
                data[offs] = spawnTime;
                spawnTime += spawnTimeStep;
                offs += stride;
            }
        }
    }
}

function createEmitter(elem: DMX.DMXElement): Emitter {
    const functionName = getAttribValue(elem, `functionName`, DMX.DMXAttributeType.String);
    if (functionName === 'emit_continuously')
        return new Emitter_Continuously(elem);
    else
        throw "whoops";
}

interface Operator extends ModuleBase {
    run(system: ParticleSystemInstance): void;
}

class Operator_LifespanDecay extends ModuleBase {
    public streamRead(): StreamMask {
        return StreamMask.SpawnTime | StreamMask.Lifetime;
    }

    public streamWrite(): StreamMask {
        return StreamMask.None;
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

class Operator_AlphaFadeInRandom extends ModuleBase {
    private readonly fadeInTimeMin: number;
    private readonly fadeInTimeMax: number;
    private readonly fadeInTimeExponent: number;
    private readonly proportional: boolean;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.fadeInTimeMin = getAttribValue(elem, `fade in time min`, DMX.DMXAttributeType.Float);
        this.fadeInTimeMax = getAttribValue(elem, `fade in time max`, DMX.DMXAttributeType.Float);
        this.fadeInTimeExponent = getAttribValue(elem, `fade in time exponent`, DMX.DMXAttributeType.Float);
        this.proportional = getAttribValue(elem, `proportional 0/1`, DMX.DMXAttributeType.Bool);
    }

    public override streamReadInit(): StreamMask {
        return StreamMask.Alpha;
    }

    public streamRead(): StreamMask {
        let mask = StreamMask.SpawnTime;
        if (this.proportional)
            mask |= StreamMask.Lifetime;
        return mask;
    }

    public streamWrite(): StreamMask {
        return StreamMask.Alpha;
    }

    public run(system: ParticleSystemInstance): void {
        const data = system.particleDataF32, dataInit = system.particleDataInitF32, stride = system.dataStride, strideInit = system.dataInitStride;
        let spawnTimeOffs = system.getStreamOffs(StreamMask.SpawnTime);
        let lifetimeOffs = this.proportional ? system.getStreamOffs(StreamMask.Lifetime) : 0;
        let alphaOffs = system.getStreamOffs(StreamMask.Alpha);
        let alphaInitOffs = system.getStreamInitOffs(StreamMask.Alpha);

        for (let p = 0; p < system.getNum(); p++) {
            let t = system.curTime - data[spawnTimeOffs];
            if (this.proportional)
                t /= data[lifetimeOffs];

            const fadeInTime = randRangeExp(system, this.fadeInTimeMin, this.fadeInTimeMax, this.fadeInTimeExponent);
            data[alphaOffs] = dataInit[alphaInitOffs] * saturate(smoothstep(t / fadeInTime));

            lifetimeOffs += stride;
            spawnTimeOffs += stride;
            alphaOffs += stride;
            alphaInitOffs += strideInit;
        }
    }
}

class Operator_AlphaFadeAndDecay extends ModuleBase {
    private readonly startAlpha: number;
    private readonly endAlpha: number;
    private readonly startFadeInTime: number;
    private readonly endFadeInTime: number;
    private readonly startFadeOutTime: number;
    private readonly endFadeOutTime: number;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.startAlpha = getAttribValue(elem, `start_alpha`, DMX.DMXAttributeType.Float);
        this.endAlpha = getAttribValue(elem, `end_alpha`, DMX.DMXAttributeType.Float);
        this.startFadeInTime = getAttribValue(elem, `start_fade_in_time`, DMX.DMXAttributeType.Float);
        this.endFadeInTime = getAttribValue(elem, `end_fade_in_time`, DMX.DMXAttributeType.Float);
        this.startFadeOutTime = getAttribValue(elem, `start_fade_out_time`, DMX.DMXAttributeType.Float);
        this.endFadeOutTime = getAttribValue(elem, `end_fade_out_time`, DMX.DMXAttributeType.Float);
    }

    public override streamReadInit(): StreamMask {
        return StreamMask.Alpha;
    }

    public streamRead(): StreamMask {
        return StreamMask.SpawnTime | StreamMask.Lifetime;
    }

    public streamWrite(): StreamMask {
        return StreamMask.Alpha;
    }
    
    public run(system: ParticleSystemInstance): void {
        const data = system.particleDataF32, dataInit = system.particleDataInitF32, stride = system.dataStride, strideInit = system.dataInitStride;
        let spawnTimeOffs = system.getStreamOffs(StreamMask.SpawnTime);
        let lifetimeOffs = system.getStreamOffs(StreamMask.Lifetime);
        let alphaOffs = system.getStreamOffs(StreamMask.Alpha);
        let alphaInitOffs = system.getStreamInitOffs(StreamMask.Alpha);

        for (let p = 0; p < system.getNum(); p++) {
            let t = system.curTime - data[spawnTimeOffs];
            const lifetime = data[lifetimeOffs];

            if (t >= lifetime) {
                system.deadParticle(p);
            } else {
                t /= lifetime;

                let alpha = dataInit[alphaInitOffs];
                if (t <= this.endFadeInTime)
                    alpha *= saturate(smoothstep(invlerp(this.startFadeInTime, this.endFadeInTime, t)));
                if (t >= this.startFadeInTime)
                    alpha *= saturate(smoothstep(invlerp(this.endFadeOutTime, this.startFadeInTime, t)));
                data[alphaOffs] = alpha;
            }

            lifetimeOffs += stride;
            spawnTimeOffs += stride;
            alphaOffs += stride;
            alphaInitOffs += strideInit;
        }
    }
}

class Operator_MovementBasic extends ModuleBase {
    private readonly gravity: ReadonlyVec3;
    private readonly drag: number;

    constructor(elem: DMX.DMXElement) {
        super(elem);
        this.gravity = getAttribValue(elem, `gravity`, DMX.DMXAttributeType.Vector3);
        this.drag = 1.0 - getAttribValue(elem, `drag`, DMX.DMXAttributeType.Float);
    }

    public streamRead(): StreamMask {
        return StreamMask.Position | StreamMask.Speed;
    }

    public streamWrite(): StreamMask {
        return StreamMask.Position | StreamMask.Speed;
    }

    public run(system: ParticleSystemInstance): void {
        const data = system.particleDataF32, stride = system.dataStride;
        let posOffs = system.getStreamOffs(StreamMask.Position);
        let speedOffs = system.getStreamOffs(StreamMask.Speed);
        const dt = system.deltaTime;
        const drag = this.drag * dt;

        // TODO: forces
        vec3.scale(scratchVec3a, this.gravity, dt ** 2.0);

        for (let p = 0; p < system.getNum(); p++) {
            for (let i = 0; i < 3; i++)
                data[posOffs + i] += (data[speedOffs + i] + scratchVec3a[i]) * drag;
            posOffs += stride;
            speedOffs += stride;
        }

        // TODO: constraints
    }
}

function createOperator(elem: DMX.DMXElement): Operator | null {
    const functionName = getAttribValue(elem, `functionName`, DMX.DMXAttributeType.String);
    if (functionName === `Lifespan Decay`)
        return new Operator_LifespanDecay(elem);
    else if (functionName === `Movement Basic`)
        return new Operator_MovementBasic(elem);
    else if (functionName === `Alpha Fade In Random`)
        return new Operator_AlphaFadeInRandom(elem);
    else if (functionName === `Alpha Fade and Decay`)
        return new Operator_AlphaFadeAndDecay(elem);
    else
        return null;
}

class ParticleControlPoint {
    public transform = mat4.create();
    public prevTransform = mat4.create();
}

export class ParticleSystemInstance {
    // System definition stuff (can be cached if desired)
    private def: DMX.DMXElement;
    private materialInstance: BaseMaterial | null = null;
    private operators: Operator[] = [];
    private initializers: Initializer[] = [];

    private streamMask: StreamMask = 0;
    private streamConstMask: StreamMask = 0;
    public dataStride: number = 0;
    private dataStreamOffs: number[] = [];
    private streamInitMask: StreamMask = 0;
    public dataInitStride: number = 0;
    private dataInitStreamOffs: number[] = [];

    // Instance stuff
    public controlPoints: ParticleControlPoint[] = [];
    public curTime: number = 0;
    public deltaTime: number = 0;

    public readonly particleDataF32: Float32Array;
    public readonly particleDataInitF32: Float32Array;
    private particleNum: number = 0;
    private particleMax: number = 0;
    private emitters: Emitter[] = [];
    private children: ParticleSystemInstance[] = [];
    private deadParticleList: number[] = [];

    private operatorRandomInit: SeededRNG;
    private otherRandom: SeededRNG;
    private random: SeededRNG;

    constructor(private renderContext: SourceRenderContext, systemName: string) {
        this.def = assertExists(this.renderContext.materialCache.particleSystemCache.getParticleSystemDefinition(systemName));

        this.particleMax = getAttribValue(this.def, `max_particles`, DMX.DMXAttributeType.Int);

        let streamWrite = StreamMask.None;
        let streamWriteInit = StreamMask.None;
        let streamRead = StreamMask.None;
        let streamReadInit = StreamMask.None;

        const renderers = getAttribValue(this.def, `renderers`, DMX.DMXAttributeType.ElementArray);
        const operators = getAttribValue(this.def, `operators`, DMX.DMXAttributeType.ElementArray);
        for (let i = 0; i < operators.length; i++) {
            const mod = createOperator(operators[i]);
            if (mod === null)
                continue;
            streamWrite |= mod.streamWrite();
            streamRead |= mod.streamRead();
            streamReadInit |= mod.streamReadInit();
            this.operators.push(mod);
        }

        const initializers = getAttribValue(this.def, `initializers`, DMX.DMXAttributeType.ElementArray);
        for (let i = 0; i < initializers.length; i++) {
            const mod = createInitializer(initializers[i]);
            streamWrite |= mod.streamWrite();
            streamWriteInit |= mod.streamWrite();
            streamRead |= mod.streamRead();
            streamReadInit |= mod.streamReadInit();
            this.initializers.push(mod);
        }

        const emitters = getAttribValue(this.def, `emitters`, DMX.DMXAttributeType.ElementArray);
        for (let i = 0; i < emitters.length; i++) {
            const mod = createEmitter(emitters[i]);
            streamWrite |= mod.streamWrite();
            streamWriteInit |= mod.streamWrite();
            streamRead |= mod.streamRead();
            streamReadInit |= mod.streamReadInit();
            this.emitters.push(mod);
        }

        const children = getAttribValue(this.def, `children`, DMX.DMXAttributeType.ElementArray);

        // Debug draw
        streamRead |= (streamWrite & (StreamMask.Color | StreamMask.Alpha | StreamMask.Radius));

        // Any stream that doesn't get written to by an initializer/emitter needs a constant init...
        this.streamConstMask = (streamRead & ~streamWriteInit) >>> 0;

        // TODO(jstpierre): We can compute a better stream mask here...
        this.streamMask = streamRead;

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

        this.particleDataF32 = new Float32Array(this.dataStride * this.particleMax);
        this.particleDataInitF32 = new Float32Array(this.dataInitStride * this.particleMax);

        const materialName = getAttribValue(this.def, 'material', DMX.DMXAttributeType.String);
        this.initMaterial(materialName);

        // Set up randoms.
        this.operatorRandomInit = new SeededRNG();
        this.operatorRandomInit.seedRandom();
        this.otherRandom = new SeededRNG();
        this.random = new SeededRNG();
        this.random.seedRandom();
    }

    public getControlPointTransform(dst: mat4, i: number, time: number): void {
        const point = this.controlPoints[i]!;
        // TODO(jstpierre): time lerp
        mat4.copy(dst, point.transform);
    }

    public ensureControlPoint(i: number): ParticleControlPoint {
        if (this.controlPoints[i] === undefined)
            this.controlPoints[i] = new ParticleControlPoint();
        return this.controlPoints[i];
    }

    public randF32(): number {
        return this.random.nextF32();
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

    public async initMaterial(materialName: string) {
        this.materialInstance = await this.renderContext.materialCache.createMaterialInstance(materialName);
    }

    public createParticles(num: number): number {
        const numToCreate = Math.min(this.particleMax - this.particleNum, num);
        const index = this.particleNum;
        this.particleNum += numToCreate;
        return index;
    }

    private emit(): void {
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
                    this.particleDataF32[offs++] = 1.0;
                    this.particleDataF32[offs++] = 1.0;
                    this.particleDataF32[offs++] = 1.0;
                } else if (stream === StreamMask.Alpha) {
                    this.particleDataF32[offs] = 1.0;
                } else if (stream === StreamMask.Radius) {
                    this.particleDataF32[offs] = 1.0;
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
        this.otherRandom.copy(this.random);
        this.random.copy(this.operatorRandomInit);

        for (let i = 0; i < this.operators.length; i++) {
            this.operators[i].run(this);

            if (this.deadParticleList.length > 0) {
                // TODO(jstpierre): Do we need to maintain in-order?
                for (let i = 0; i < this.deadParticleList.length; i++) {
                    const dstIdx = this.deadParticleList[i], srcIdx = --this.particleNum;
                    this.particleDataF32.copyWithin(this.dataStride * dstIdx, this.dataStride * srcIdx, this.dataStride * srcIdx + this.dataStride);
                    this.particleDataInitF32.copyWithin(this.dataInitStride * dstIdx, this.dataInitStride * srcIdx, this.dataInitStride * srcIdx + this.dataInitStride);
                }

                this.deadParticleList.length = 0;
            }
        }

        this.random.copy(this.otherRandom);
    }

    public movement(renderContext: SourceRenderContext): void {
        this.deltaTime = renderContext.globalDeltaTime;
        this.curTime += this.deltaTime;
        this.emit();
        this.operate();
    }

    private debugDraw(renderContext: SourceRenderContext): void {
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
        if (this.materialInstance === null)
            return;

        this.debugDraw(renderContext);
    }
}

export class ParticleSystemController {
    private controlPointEntity: BaseEntity[] = [];

    constructor(public instance: ParticleSystemInstance, public entity: BaseEntity) {
        this.controlPointEntity[0] = this.entity;
        this.instance.ensureControlPoint(0);
    }

    public addControlPoint(i: number, entity: BaseEntity): void {
        this.controlPointEntity[i] = entity;
        this.instance.ensureControlPoint(i);
    }

    public movement(renderContext: SourceRenderContext): void {
        for (let i = 0; i < this.controlPointEntity.length; i++) {
            const entity = this.controlPointEntity[i];
            if (entity === undefined)
                continue;

            const point = this.instance.controlPoints[i];
            mat4.copy(point.prevTransform, point.transform);
            mat4.copy(point.transform, entity.updateModelMatrix());
        }

        this.instance.movement(renderContext);
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager): void {
        this.instance.prepareToRender(renderContext, renderInstManager);
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
        if (manifestData === null)
            return;

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

        const systemDefs = getAttribValue(dmxData.rootElement, `particleSystemDefinitions`, DMX.DMXAttributeType.ElementArray);
        for (let i = 0; i < systemDefs.length; i++)
            this.systemDefinitions.push(systemDefs[i]);
    }
}
