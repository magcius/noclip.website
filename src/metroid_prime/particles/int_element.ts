import { ParticleGlobals, NumberHolder } from './base_generator';
import { InputStream } from '../stream';
import { clamp, lerp, randomRange } from '../../MathHelpers';
import { GetRealElement, RealElement, REConstant } from './real_element';
import { BaseKeyframeEmitter, BaseKeyframeFunction } from './base_keyframes';

export interface IntElement {
    GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean;
}

export class IEKeyframeEmitter extends BaseKeyframeEmitter<number, NumberHolder> implements IntElement {
    ReadKey(stream: InputStream): number {
        return stream.readUint32();
    }

    AssignValue(valOut: NumberHolder, key: number): void {
        valOut.value = key;
    }

    LerpValue(valOut: NumberHolder, keyA: number, keyB: number, t: number): void {
        valOut.value = Math.trunc(lerp(keyA, keyB, t));
    }
}

export class IEKeyframeFunction extends BaseKeyframeFunction<number, NumberHolder> implements IntElement {
    ReadKey(stream: InputStream): number {
        return stream.readUint32();
    }

    AssignValue(valOut: NumberHolder, key: number): void {
        valOut.value = key;
    }

    LerpValue(valOut: NumberHolder, keyA: number, keyB: number, t: number): void {
        valOut.value = Math.trunc(lerp(keyA, keyB, t));
    }
}

export class IEDeath implements IntElement {
    constructor(private a: IntElement, private b: IntElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const b = { value: 0 };
        this.a.GetValue(frame, globals, valOut);
        this.b.GetValue(frame, globals, b);
        return frame > b.value;
    }
}

export class IEClamp implements IntElement {
    constructor(private min: IntElement, private max: IntElement, private val: IntElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const min = { value: 0 };
        const max = { value: 0 };
        const val = { value: 0 };
        this.min.GetValue(frame, globals, min);
        this.max.GetValue(frame, globals, max);
        this.val.GetValue(frame, globals, val);
        valOut.value = clamp(val.value, min.value, max.value);
        return false;
    }
}

export class IETimeChain implements IntElement {
    constructor(private a: IntElement, private b: IntElement, private swFrame: IntElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const swFrame = { value: 0 };
        this.swFrame.GetValue(frame, globals, swFrame);
        if (frame >= swFrame.value)
            return this.b.GetValue(frame, globals, valOut);
        else
            return this.a.GetValue(frame, globals, valOut);
    }
}

export class IEAdd implements IntElement {
    constructor(private a: IntElement, private b: IntElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const a = { value: 0 };
        const b = { value: 0 };
        this.a.GetValue(frame, globals, a);
        this.b.GetValue(frame, globals, b);
        valOut.value = a.value + b.value;
        return false;
    }
}

export class IEConstant implements IntElement {
    constructor(private val: number) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        valOut.value = this.val;
        return false;
    }
}

export class IEImpulse implements IntElement {
    constructor(private a: IntElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        if (frame === 0)
            this.a.GetValue(frame, globals, valOut);
        else
            valOut.value = 0;
        return false;
    }
}

export class IELifetimePercent implements IntElement {
    constructor(private percentVal: IntElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const percentVal = { value: 0 };
        this.percentVal.GetValue(frame, globals, percentVal);
        valOut.value = Math.trunc(Math.max(0, percentVal.value) / 100.0 * globals.particleLifetime + 0.5);
        return false;
    }
}

export class IEInitialRandom implements IntElement {
    constructor(private min: IntElement, private max: IntElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        if (frame === 0) {
            const min = { value: 0 };
            const max = { value: 0 };
            this.min.GetValue(frame, globals, min);
            this.max.GetValue(frame, globals, max);
            valOut.value = Math.trunc(randomRange(min.value, max.value));
        }
        return false;
    }
}

export class IEPulse implements IntElement {
    constructor(private aDuration: IntElement, private bDuration: IntElement, private a: IntElement, private b: IntElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const aDuration = { value: 0 };
        const bDuration = { value: 0 };
        this.aDuration.GetValue(frame, globals, aDuration);
        this.bDuration.GetValue(frame, globals, bDuration);
        let end = aDuration.value + bDuration.value + 1;
        if (end < 0)
            end = 1;

        if (bDuration.value < 1 || frame % end <= aDuration.value)
            this.a.GetValue(frame, globals, valOut);
        else
            this.b.GetValue(frame, globals, valOut);
        return false;
    }
}

export class IEMultiply implements IntElement {
    constructor(private a: IntElement, private b: IntElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const a = { value: 0 };
        const b = { value: 0 };
        this.a.GetValue(frame, globals, a);
        this.b.GetValue(frame, globals, b);
        valOut.value = a.value * b.value;
        return false;
    }
}

export class IESampleAndHold implements IntElement {
    nextSampleFrame: number = 0;
    holdVal: number = 0;

    constructor(private sampleSource: IntElement, private waitFramesMin: IntElement, private waitFramesMax: IntElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        if (this.nextSampleFrame < frame) {
            const waitFramesMin = { value: 0 };
            const waitFramesMax = { value: 0 };
            const sampleSource = { value: 0 };
            this.waitFramesMin.GetValue(frame, globals, waitFramesMin);
            this.waitFramesMax.GetValue(frame, globals, waitFramesMax);
            this.nextSampleFrame = Math.trunc(randomRange(waitFramesMin.value, waitFramesMax.value)) + frame;
            this.sampleSource.GetValue(frame, globals, sampleSource);
            this.holdVal = sampleSource.value;
        }
        valOut.value = this.holdVal;
        return false;
    }
}

export class IERandom implements IntElement {
    constructor(private min: IntElement, private max: IntElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const min = { value: 0 };
        const max = { value: 0 };
        this.min.GetValue(frame, globals, min);
        this.max.GetValue(frame, globals, max);
        if (min.value > 0)
            valOut.value = Math.trunc(randomRange(min.value, max.value));
        else
            valOut.value = Math.trunc(Math.random() * 0xffff);
        return false;
    }
}

export class IETimeScale implements IntElement {
    constructor(private a: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const a = { value: 0 };
        this.a.GetValue(frame, globals, a);
        valOut.value = Math.trunc(a.value * frame);
        return false;
    }
}

export class IEGetCumulativeParticleCount implements IntElement {
    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        valOut.value = globals.currentParticleSystem.GetCumulativeParticleCount();
        return false;
    }
}

export class IEGetActiveParticleCount implements IntElement {
    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        valOut.value = globals.currentParticleSystem.GetParticleCount();
        return false;
    }
}

export class IEGetEmitterTime implements IntElement {
    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        valOut.value = globals.currentParticleSystem.GetEmitterTime();
        return false;
    }
}

export class IEModulo implements IntElement {
    constructor(private a: IntElement, private b: IntElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const a = { value: 0 };
        const b = { value: 0 };
        this.a.GetValue(frame, globals, a);
        this.b.GetValue(frame, globals, b);
        if (b.value !== 0)
            valOut.value = a.value % b.value;
        else
            valOut.value = a.value;
        return false;
    }
}

export class IESubtract implements IntElement {
    constructor(private a: IntElement, private b: IntElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const a = { value: 0 };
        const b = { value: 0 };
        this.a.GetValue(frame, globals, a);
        this.b.GetValue(frame, globals, b);
        valOut.value = a.value - b.value;
        return false;
    }
}

export class IERealToInt implements IntElement {
    constructor(private a: RealElement, private b: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const a = { value: 0 };
        const b = { value: 0 };
        this.b.GetValue(frame, globals, b);
        this.a.GetValue(frame, globals, a);
        valOut.value = Math.trunc(a.value * b.value);
        return false;
    }
}

// Added in MP2
export class IEGTCP implements IntElement {
    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        // TODO: Figure out the members accessed
        valOut.value = 0;
        return false;
    }
}

// Added in MP2
export class IEDivide implements IntElement {
    constructor(private a: IntElement, private b: IntElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const a = { value: 0 };
        const b = { value: 0 };
        this.a.GetValue(frame, globals, a);
        this.b.GetValue(frame, globals, b);
        valOut.value = b.value === 0 ? a.value : (a.value / b.value);
        return false;
    }
}

export function GetIntElement(stream: InputStream): IntElement | null {
    const type = stream.readFourCC();
    switch (type) {
    case 'KEYE':
    case 'KEYP':
        return new IEKeyframeEmitter(stream);
    case 'KEYF':
        return new IEKeyframeFunction(stream);
    case 'DETH': {
        const a = GetIntElement(stream);
        const b = GetIntElement(stream);
        return new IEDeath(a!, b!);
    }
    case 'CLMP': {
        const a = GetIntElement(stream);
        const b = GetIntElement(stream);
        const c = GetIntElement(stream);
        return new IEClamp(a!, b!, c!);
    }
    case 'CHAN': {
        const a = GetIntElement(stream);
        const b = GetIntElement(stream);
        const c = GetIntElement(stream);
        return new IETimeChain(a!, b!, c!);
    }
    case 'ADD_': {
        const a = GetIntElement(stream);
        const b = GetIntElement(stream);
        return new IEAdd(a!, b!);
    }
    case 'CNST': {
        const a = stream.readInt32();
        return new REConstant(a);
    }
    case 'IMPL': {
        const a = GetIntElement(stream);
        return new IEImpulse(a!);
    }
    case 'ILPT': {
        const a = GetIntElement(stream);
        return new IELifetimePercent(a!);
    }
    case 'IRND': {
        const a = GetIntElement(stream);
        const b = GetIntElement(stream);
        return new IEInitialRandom(a!, b!);
    }
    case 'PULS': {
        const a = GetIntElement(stream);
        const b = GetIntElement(stream);
        const c = GetIntElement(stream);
        const d = GetIntElement(stream);
        return new IEPulse(a!, b!, c!, d!);
    }
    case 'MULT': {
        const a = GetIntElement(stream);
        const b = GetIntElement(stream);
        return new IEMultiply(a!, b!);
    }
    case 'SPAH': {
        const a = GetIntElement(stream);
        const b = GetIntElement(stream);
        const c = GetIntElement(stream);
        return new IESampleAndHold(a!, b!, c!);
    }
    case 'RAND': {
        const a = GetIntElement(stream);
        const b = GetIntElement(stream);
        return new IERandom(a!, b!);
    }
    case 'RTOI': {
        const a = GetRealElement(stream);
        const b = GetRealElement(stream);
        return new IERealToInt(a!, b!);
    }
    case 'TSCL': {
        const a = GetRealElement(stream);
        return new IETimeScale(a!);
    }
    case 'GAPC':
        return new IEGetActiveParticleCount();
    case 'CTCP':
        return new IEGetCumulativeParticleCount();
    case 'GEMT':
        return new IEGetEmitterTime();
    case 'MODU': {
        const a = GetIntElement(stream);
        const b = GetIntElement(stream);
        return new IEModulo(a!, b!);
    }
    case 'SUB_': {
        const a = GetIntElement(stream);
        const b = GetIntElement(stream);
        return new IESubtract(a!, b!);
    }
    case 'DIVD': {
        const a = GetIntElement(stream);
        const b = GetIntElement(stream);
        return new IEDivide(a!, b!);
    }
    case 'GTCP':
        return new IEGTCP();
    case 'NONE':
        return null;
    default:
        throw `unrecognized element type ${type}`;
    }
}
