import { defaultParticleGlobals, GetBool, NumberHolder, ParticleGlobals } from './base_generator';
import { InputStream } from '../stream';
import { clamp, lerp, MathConstants, randomRange } from '../../MathHelpers';
import { GetIntElement, IntElement } from './int_element';
import { GetVectorElement, VectorElement } from './vector_element';
import { ColorElement, GetColorElement } from './color_element';
import { vec3 } from 'gl-matrix';
import { colorNewFromRGBA } from '../../Color';
import { BaseKeyframeEmitter, BaseKeyframeFunction } from './base_keyframes';

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchColor = colorNewFromRGBA(1.0, 1.0, 1.0, 1.0);

export interface RealElement {
    GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean;
    IsConstant(): boolean;
}

export class REKeyframeEmitter extends BaseKeyframeEmitter<number, NumberHolder> implements RealElement {
    ReadKey(stream: InputStream): number {
        return stream.readFloat32();
    }

    AssignValue(valOut: NumberHolder, key: number): void {
        valOut.value = key;
    }

    LerpValue(valOut: NumberHolder, keyA: number, keyB: number, t: number): void {
        valOut.value = lerp(keyA, keyB, t);
    }

    IsConstant(): boolean { return false; }
}

export class REKeyframeFunction extends BaseKeyframeFunction<number, NumberHolder> implements RealElement {
    public ReadKey(stream: InputStream): number {
        return stream.readFloat32();
    }

    AssignValue(valOut: NumberHolder, key: number): void {
        valOut.value = key;
    }

    LerpValue(valOut: NumberHolder, keyA: number, keyB: number, t: number): void {
        valOut.value = lerp(keyA, keyB, t);
    }

    IsConstant(): boolean { return false; }
}

export class RELifetimeTween implements RealElement {
    constructor(private a: RealElement, private b: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const t = frame / globals.particleLifetime;
        const a = { value: 0 };
        const b = { value: 0 };
        this.a.GetValue(frame, globals, a);
        this.b.GetValue(frame, globals, b);
        valOut.value = lerp(a.value, b.value, t);
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REConstant implements RealElement {
    constructor(private val: number) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        valOut.value = this.val;
        return false;
    }

    IsConstant(): boolean { return true; }
}

export class RETimeChain implements RealElement {
    constructor(private a: RealElement, private b: RealElement, private swFrame: IntElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const swFrame = { value: 0 };
        this.swFrame.GetValue(frame, globals, swFrame);
        if (frame >= swFrame.value)
            return this.b.GetValue(frame, globals, valOut);
        else
            return this.a.GetValue(frame, globals, valOut);
    }

    IsConstant(): boolean { return false; }
}

export class REAdd implements RealElement {
    constructor(private a: RealElement, private b: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const a = { value: 0 };
        const b = { value: 0 };
        this.a.GetValue(frame, globals, a);
        this.b.GetValue(frame, globals, b);
        valOut.value = a.value + b.value;
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REClamp implements RealElement {
    constructor(private min: RealElement, private max: RealElement, private val: RealElement) {
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

    IsConstant(): boolean { return false; }
}

export class REInitialRandom implements RealElement {
    constructor(private min: RealElement, private max: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        if (frame === 0) {
            const min = { value: 0 };
            const max = { value: 0 };
            this.min.GetValue(frame, globals, min);
            this.max.GetValue(frame, globals, max);
            valOut.value = randomRange(min.value, max.value);
        }
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class RERandom implements RealElement {
    constructor(private min: RealElement, private max: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const min = { value: 0 };
        const max = { value: 0 };
        this.min.GetValue(frame, globals, min);
        this.max.GetValue(frame, globals, max);
        valOut.value = randomRange(min.value, max.value);
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REDotProduct implements RealElement {
    constructor(private a: VectorElement, private b: VectorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        this.a.GetValue(frame, globals, scratchVec3a);
        this.b.GetValue(frame, globals, scratchVec3b);
        valOut.value = vec3.dot(scratchVec3a, scratchVec3b);
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REMultiply implements RealElement {
    constructor(private a: RealElement, private b: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const a = { value: 0 };
        const b = { value: 0 };
        this.a.GetValue(frame, globals, a);
        this.b.GetValue(frame, globals, b);
        valOut.value = a.value * b.value;
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REPulse implements RealElement {
    constructor(private aDuration: IntElement, private bDuration: IntElement, private a: RealElement, private b: RealElement) {
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

    IsConstant(): boolean { return false; }
}

export class RETimeScale implements RealElement {
    constructor(private a: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const a = { value: 0 };
        this.a.GetValue(frame, globals, a);
        valOut.value = a.value * frame;
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class RELifetimePercent implements RealElement {
    constructor(private percentVal: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const percentVal = { value: 0 };
        this.percentVal.GetValue(frame, globals, percentVal);
        valOut.value = Math.max(0, percentVal.value) / 100.0 * globals.particleLifetime + 0.5;
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class RESineWave implements RealElement {
    constructor(private frequency: RealElement, private amplitude: RealElement, private phase: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const frequency = { value: 0 };
        const amplitude = { value: 0 };
        const phase = { value: 0 };
        this.frequency.GetValue(frame, globals, frequency);
        this.amplitude.GetValue(frame, globals, amplitude);
        this.phase.GetValue(frame, globals, phase);
        valOut.value = Math.sin(MathConstants.DEG_TO_RAD * (frame * frequency.value + phase.value)) * amplitude.value;
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REInitialSwitch implements RealElement {
    constructor(private a: RealElement, private b: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        if (frame === 0)
            this.a.GetValue(frame, globals, valOut);
        else
            this.b.GetValue(frame, globals, valOut);
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class RECompareLessThan implements RealElement {
    constructor(private a: RealElement, private b: RealElement, private ifVal: RealElement, private elseVal: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const a = { value: 0 };
        const b = { value: 0 };
        this.a.GetValue(frame, globals, a);
        this.b.GetValue(frame, globals, b);
        if (a.value < b.value)
            this.ifVal.GetValue(frame, globals, valOut);
        else
            this.elseVal.GetValue(frame, globals, valOut);
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class RECompareEquals implements RealElement {
    constructor(private a: RealElement, private b: RealElement, private ifVal: RealElement, private elseVal: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const a = { value: 0 };
        const b = { value: 0 };
        this.a.GetValue(frame, globals, a);
        this.b.GetValue(frame, globals, b);
        if (Math.abs(a.value - b.value) < 0.00001)
            this.ifVal.GetValue(frame, globals, valOut);
        else
            this.elseVal.GetValue(frame, globals, valOut);
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REParticleAccessParam1 implements RealElement {
    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        valOut.value = globals.particleAccessParameters![0].value;
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REParticleAccessParam2 implements RealElement {
    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        valOut.value = globals.particleAccessParameters![1].value;
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REParticleAccessParam3 implements RealElement {
    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        valOut.value = globals.particleAccessParameters![2].value;
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REParticleAccessParam4 implements RealElement {
    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        valOut.value = globals.particleAccessParameters![3].value;
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REParticleAccessParam5 implements RealElement {
    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        valOut.value = globals.particleAccessParameters![4].value;
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REParticleAccessParam6 implements RealElement {
    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        valOut.value = globals.particleAccessParameters![5].value;
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REParticleAccessParam7 implements RealElement {
    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        valOut.value = globals.particleAccessParameters![6].value;
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REParticleAccessParam8 implements RealElement {
    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        valOut.value = globals.particleAccessParameters![7].value;
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REParticleSizeOrLineLength implements RealElement {
    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        valOut.value = globals.currentParticle.lineLengthOrSize.value;
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REParticleRotationOrLineWidth implements RealElement {
    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        valOut.value = globals.currentParticle.lineWidthOrRota.value;
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class RESubtract implements RealElement {
    constructor(private a: RealElement, private b: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const a = { value: 0 };
        const b = { value: 0 };
        this.a.GetValue(frame, globals, a);
        this.b.GetValue(frame, globals, b);
        valOut.value = a.value - b.value;
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REVectorMagnitude implements RealElement {
    constructor(private a: VectorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        this.a.GetValue(frame, globals, scratchVec3a);
        valOut.value = vec3.length(scratchVec3a);
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REVectorXToReal implements RealElement {
    constructor(private a: VectorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        this.a.GetValue(frame, globals, scratchVec3a);
        valOut.value = scratchVec3a[0];
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REVectorYToReal implements RealElement {
    constructor(private a: VectorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        this.a.GetValue(frame, globals, scratchVec3a);
        valOut.value = scratchVec3a[1];
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REVectorZToReal implements RealElement {
    constructor(private a: VectorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        this.a.GetValue(frame, globals, scratchVec3a);
        valOut.value = scratchVec3a[2];
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REExternalVar implements RealElement {
    constructor(private a: IntElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const a = { value: 0 };
        this.a.GetValue(frame, globals, a);
        valOut.value = globals.currentParticleSystem.GetExternalVar(Math.max(0, a.value) & 0xf);
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REIntTimesReal implements RealElement {
    constructor(private a: IntElement, private b: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const a = { value: 0 };
        const b = { value: 0 };
        this.a.GetValue(frame, globals, a);
        this.b.GetValue(frame, globals, b);
        valOut.value = a.value * b.value;
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REConstantRange implements RealElement {
    constructor(private val: RealElement, private min: RealElement, private max: RealElement,
                private inRange: RealElement, private outOfRange: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        const val = { value: 0 };
        const min = { value: 0 };
        const max = { value: 0 };
        this.val.GetValue(frame, globals, val);
        this.min.GetValue(frame, globals, min);
        this.max.GetValue(frame, globals, max);

        if (val.value > min.value && val.value < max.value)
            this.inRange.GetValue(frame, globals, valOut);
        else
            this.outOfRange.GetValue(frame, globals, valOut);

        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REGetComponentRed implements RealElement {
    constructor(private a: ColorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        this.a.GetValue(frame, globals, scratchColor);
        valOut.value = scratchColor.r;
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REGetComponentGreen implements RealElement {
    constructor(private a: ColorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        this.a.GetValue(frame, globals, scratchColor);
        valOut.value = scratchColor.g;
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REGetComponentBlue implements RealElement {
    constructor(private a: ColorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        this.a.GetValue(frame, globals, scratchColor);
        valOut.value = scratchColor.b;
        return false;
    }

    IsConstant(): boolean { return false; }
}

export class REGetComponentAlpha implements RealElement {
    constructor(private a: ColorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        this.a.GetValue(frame, globals, scratchColor);
        valOut.value = scratchColor.a;
        return false;
    }

    IsConstant(): boolean { return false; }
}

// Added in MP2
export class RETOCS implements RealElement {
    x14: NumberHolder = { value: 0 };
    x18: NumberHolder = { value: 0 };
    x1c: NumberHolder = { value: 0 };
    x20: NumberHolder = { value: 0 };
    x24: number = 0;
    x28: number = 0xffffffff;

    constructor(private x10: boolean, private x4: IntElement | null, private x8: IntElement | null, private xc: IntElement | null) {
        if (x4) {
            x4.GetValue(0, defaultParticleGlobals, this.x14);
        }
        if (x8) {
            x8.GetValue(0, defaultParticleGlobals, this.x18);
        }
        if (this.x1c.value !== 0) { // Appears to be a typographical error in the original code
            xc!.GetValue(0, defaultParticleGlobals, this.x1c);
        }
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        if (this.x28 !== frame) {
            this.x28 = frame;
            if (this.x20.value < 1) {
                const v2 = this.x24 % this.x14.value;
                if (v2 === 0) {
                    let elem;
                    let value;
                    if ((Math.trunc(this.x24 / this.x14.value) & 1) === 0) {
                        elem = this.x8;
                        value = this.x18.value;
                    } else {
                        elem = this.xc;
                        value = this.x1c.value;
                    }
                    this.x20.value = value;
                    elem!.GetValue(this.x24, globals, this.x20);
                    this.x20.value = Math.max(0, this.x20.value);
                } else if (!this.x10) {
                    valOut.value = v2;
                } else {
                    const v2 = this.x24 % (this.x14.value * 2);
                    if (v2 < this.x14.value) {
                        valOut.value = v2;
                    } else {
                        valOut.value = this.x14.value - (v2 % this.x14.value);
                    }
                }
                ++this.x24;
            } else {
                --this.x20.value;
            }
        }
        return false;
    }

    IsConstant(): boolean { return false; }
}

// Added in MP2
export class REKPIN implements RealElement {
    constructor(private a: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        if (frame === 0) {
            this.a.GetValue(0, globals, valOut);
        }
        return false;
    }

    IsConstant(): boolean { return false; }
}

// Added in MP2
export class REPNO2 implements RealElement {
    constructor(private a: RealElement, private b: RealElement, private c: RealElement, private d: RealElement, private e: IntElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        valOut.value = 0;
        // TODO: Implement
        return false;
    }

    IsConstant(): boolean { return false; }
}

// Added in MP2
export class REGTCP implements RealElement {
    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        // TODO: Figure out the members accessed
        valOut.value = 0.0;
        return false;
    }

    IsConstant(): boolean { return false; }
}

// Added in MP2
export class REOCSP implements RealElement {
    constructor(private a: IntElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, valOut: NumberHolder): boolean {
        // TODO: Implement
        valOut.value = 0;
        return false;
    }

    IsConstant(): boolean { return false; }
}

export function GetRealElement(stream: InputStream): RealElement | null {
    const type = stream.readFourCC();
    switch (type) {
    case 'LFTW': {
        const a = GetRealElement(stream);
        const b = GetRealElement(stream);
        return new RELifetimeTween(a!, b!);
    }
    case 'CNST': {
        const a = stream.readFloat32();
        return new REConstant(a);
    }
    case 'CHAN': {
        const a = GetRealElement(stream);
        const b = GetRealElement(stream);
        const c = GetIntElement(stream);
        return new RETimeChain(a!, b!, c!);
    }
    case 'ADD_': {
        const a = GetRealElement(stream);
        const b = GetRealElement(stream);
        return new REAdd(a!, b!);
    }
    case 'CLMP': {
        const a = GetRealElement(stream);
        const b = GetRealElement(stream);
        const c = GetRealElement(stream);
        return new REClamp(a!, b!, c!);
    }
    case 'KEYE':
    case 'KEYP':
        return new REKeyframeEmitter(stream);
    case 'KEYF':
        return new REKeyframeFunction(stream);
    case 'IRND': {
        const a = GetRealElement(stream);
        const b = GetRealElement(stream);
        return new REInitialRandom(a!, b!);
    }
    case 'RAND': {
        const a = GetRealElement(stream);
        const b = GetRealElement(stream);
        return new RERandom(a!, b!);
    }
    case 'DOTP': {
        const a = GetVectorElement(stream);
        const b = GetVectorElement(stream);
        return new REDotProduct(a!, b!);
    }
    case 'MULT': {
        const a = GetRealElement(stream);
        const b = GetRealElement(stream);
        return new REMultiply(a!, b!);
    }
    case 'PULS': {
        const a = GetIntElement(stream);
        const b = GetIntElement(stream);
        const c = GetRealElement(stream);
        const d = GetRealElement(stream);
        return new REPulse(a!, b!, c!, d!);
    }
    case 'SCAL': {
        const a = GetRealElement(stream);
        return new RETimeScale(a!);
    }
    case 'RLPT': {
        const a = GetRealElement(stream);
        return new RELifetimePercent(a!);
    }
    case 'SINE': {
        const a = GetRealElement(stream);
        const b = GetRealElement(stream);
        const c = GetRealElement(stream);
        return new RESineWave(a!, b!, c!);
    }
    case 'ISWT': {
        const a = GetRealElement(stream);
        const b = GetRealElement(stream);
        return new REInitialSwitch(a!, b!);
    }
    case 'CLTN': {
        const a = GetRealElement(stream);
        const b = GetRealElement(stream);
        const c = GetRealElement(stream);
        const d = GetRealElement(stream);
        return new RECompareLessThan(a!, b!, c!, d!);
    }
    case 'CEQL': {
        const a = GetRealElement(stream);
        const b = GetRealElement(stream);
        const c = GetRealElement(stream);
        const d = GetRealElement(stream);
        return new RECompareEquals(a!, b!, c!, d!);
    }
    case 'PAP1':
        return new REParticleAccessParam1();
    case 'PAP2':
        return new REParticleAccessParam2();
    case 'PAP3':
        return new REParticleAccessParam3();
    case 'PAP4':
        return new REParticleAccessParam4();
    case 'PAP5':
        return new REParticleAccessParam5();
    case 'PAP6':
        return new REParticleAccessParam6();
    case 'PAP7':
        return new REParticleAccessParam7();
    case 'PAP8':
        return new REParticleAccessParam8();
    case 'PSLL':
        return new REParticleSizeOrLineLength();
    case 'PRLW':
        return new REParticleRotationOrLineWidth();
    case 'SUB_': {
        const a = GetRealElement(stream);
        const b = GetRealElement(stream);
        return new RESubtract(a!, b!);
    }
    case 'VMAG': {
        const a = GetVectorElement(stream);
        return new REVectorMagnitude(a!);
    }
    case 'VXTR': {
        const a = GetVectorElement(stream);
        return new REVectorXToReal(a!);
    }
    case 'VYTR': {
        const a = GetVectorElement(stream);
        return new REVectorYToReal(a!);
    }
    case 'VZTR': {
        const a = GetVectorElement(stream);
        return new REVectorZToReal(a!);
    }
    case 'CEXT': {
        const a = GetIntElement(stream);
        return new REExternalVar(a!);
    }
    case 'ITRL': {
        const a = GetIntElement(stream);
        const b = GetRealElement(stream);
        return new REIntTimesReal(a!, b!);
    }
    case 'CRNG': {
        const a = GetRealElement(stream);
        const b = GetRealElement(stream);
        const c = GetRealElement(stream);
        const d = GetRealElement(stream);
        const e = GetRealElement(stream);
        return new REConstantRange(a!, b!, c!, d!, e!);
    }
    case 'GTCR': {
        const a = GetColorElement(stream);
        return new REGetComponentRed(a!);
    }
    case 'GTCG': {
        const a = GetColorElement(stream);
        return new REGetComponentGreen(a!);
    }
    case 'GTCB': {
        const a = GetColorElement(stream);
        return new REGetComponentBlue(a!);
    }
    case 'GTCA': {
        const a = GetColorElement(stream);
        return new REGetComponentAlpha(a!);
    }
    case 'TOCS': {
        const a = GetBool(stream);
        const b = GetIntElement(stream);
        const c = GetIntElement(stream);
        const d = GetIntElement(stream);
        return new RETOCS(a, b, c, d);
    }
    case 'KPIN': {
        const a = GetRealElement(stream);
        return new REKPIN(a!);
    }
    case 'PNO2': {
        const a = GetRealElement(stream);
        const b = GetRealElement(stream);
        const c = GetRealElement(stream);
        const d = GetRealElement(stream);
        const e = GetIntElement(stream);
        return new REPNO2(a!, b!, c!, d!, e!);
    }
    case 'GTCP':
        return new REGTCP();
    case 'OCSP': {
        const a = GetIntElement(stream);
        return new REOCSP(a!);
    }
    case 'NONE':
        return null;
    default:
        throw `unrecognized element type ${type}`;
    }
}
