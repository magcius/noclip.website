import { InputStream } from '../stream';
import { ParticleGlobals, defaultParticleGlobals } from './base_generator';
import { GetRealElement, RealElement } from './real_element';
import { GetIntElement, IntElement } from './int_element';
import { Color, colorCopy, colorLerp, colorMult, colorNewFromRGBA } from '../../Color';
import { BaseKeyframeEmitter, BaseKeyframeFunction } from './base_keyframes';
import { GetVectorElement, VectorElement } from './vector_element';
import { vec3 } from 'gl-matrix';
import { saturate } from '../../MathHelpers';

const scratchColor = colorNewFromRGBA(1.0, 1.0, 1.0, 1.0);
const scratchVec3 = vec3.create();

export interface ColorElement {
    GetValue(frame: number, globals: ParticleGlobals, colorOut: Color): boolean;
}

export class CEKeyframeEmitter extends BaseKeyframeEmitter<Color, Color> implements ColorElement {
    ReadKey(stream: InputStream): Color {
        return stream.readColor(colorNewFromRGBA(1.0, 1.0, 1.0, 1.0));
    }

    AssignValue(colorOut: Color, key: Color): void {
        colorCopy(colorOut, key);
    }

    LerpValue(colorOut: Color, keyA: Color, keyB: Color, t: number): void {
        colorLerp(colorOut, keyA, keyB, t);
    }
}

export class CEKeyframeFunction extends BaseKeyframeFunction<Color, Color> implements ColorElement {
    ReadKey(stream: InputStream): Color {
        return stream.readColor(colorNewFromRGBA(1.0, 1.0, 1.0, 1.0));
    }

    AssignValue(colorOut: Color, key: Color): void {
        colorCopy(colorOut, key);
    }

    LerpValue(colorOut: Color, keyA: Color, keyB: Color, t: number): void {
        colorLerp(colorOut, keyA, keyB, t);
    }
}

export class CEConstant implements ColorElement {
    constructor(private r: RealElement, private g: RealElement, private b: RealElement, private a: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, colorOut: Color): boolean {
        const r = { value: 0 };
        const g = { value: 0 };
        const b = { value: 0 };
        const a = { value: 0 };
        this.r.GetValue(frame, globals, r);
        this.g.GetValue(frame, globals, g);
        this.b.GetValue(frame, globals, b);
        this.a.GetValue(frame, globals, a);
        colorOut.r = r.value;
        colorOut.g = g.value;
        colorOut.b = b.value;
        colorOut.a = a.value;
        return false;
    }
}

export class CEFastConstant implements ColorElement {
    constructor(private r: number, private g: number, private b: number, private a: number) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, colorOut: Color): boolean {
        colorOut.r = this.r;
        colorOut.g = this.g;
        colorOut.b = this.b;
        colorOut.a = this.a;
        return false;
    }
}

export class CETimeChain implements ColorElement {
    constructor(private a: ColorElement, private b: ColorElement, private swFrame: IntElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, colorOut: Color): boolean {
        const swFrame = { value: 0 };
        this.swFrame.GetValue(frame, globals, swFrame);
        if (frame >= swFrame.value)
            return this.b.GetValue(frame, globals, colorOut);
        else
            return this.a.GetValue(frame, globals, colorOut);
    }
}

export class CEFadeEnd implements ColorElement {
    constructor(private a: ColorElement, private b: ColorElement, private startFrame: RealElement, private endFrame: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, colorOut: Color): boolean {
        const startFrame = { value: 0 };
        this.startFrame.GetValue(frame, globals, startFrame);

        if (frame < startFrame.value) {
            this.a.GetValue(frame, globals, colorOut);
            return false;
        }

        const endFrame = { value: 0 };
        this.endFrame.GetValue(frame, globals, endFrame);

        this.a.GetValue(frame, globals, colorOut);
        this.b.GetValue(frame, globals, scratchColor);

        const t = (frame - startFrame.value) / (endFrame.value - startFrame.value);
        colorLerp(colorOut, colorOut, scratchColor, t);
        return false;
    }
}

export class CEFade implements ColorElement {
    constructor(private a: ColorElement, private b: ColorElement, private endFrame: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, colorOut: Color): boolean {
        const endFrame = { value: 0 };
        this.endFrame.GetValue(frame, globals, endFrame);

        const t = frame / endFrame.value;
        if (t > 1.0) {
            this.b.GetValue(frame, globals, colorOut);
            return false;
        }

        this.a.GetValue(frame, globals, colorOut);
        this.b.GetValue(frame, globals, scratchColor);

        colorLerp(colorOut, colorOut, scratchColor, t);
        return false;
    }
}

export class CEPulse implements ColorElement {
    constructor(private aDuration: IntElement, private bDuration: IntElement, private a: ColorElement, private b: ColorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, colorOut: Color): boolean {
        const aDuration = { value: 0 };
        const bDuration = { value: 0 };
        this.aDuration.GetValue(frame, globals, aDuration);
        this.bDuration.GetValue(frame, globals, bDuration);
        let end = aDuration.value + bDuration.value + 1;
        if (end < 0)
            end = 1;

        if (bDuration.value < 1 || frame % end <= aDuration.value)
            this.a.GetValue(frame, globals, colorOut);
        else
            this.b.GetValue(frame, globals, colorOut);

        return false;
    }
}

export class CEParticleColor implements ColorElement {
    public GetValue(frame: number, globals: ParticleGlobals, colorOut: Color): boolean {
        colorCopy(colorOut, globals.currentParticle.color);
        return false;
    }
}

// Added in MP2
export class CEModulateAlpha implements ColorElement {
    constructor(private color: ColorElement, private alpha: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, colorOut: Color): boolean {
        this.color.GetValue(frame, globals, colorOut);
        const alpha = { value: 1.0 };
        this.alpha.GetValue(frame, globals, alpha);
        colorOut.a = alpha.value;
        return false;
    }
}

// Added in MP2
export class CEKPIN implements ColorElement {
    constructor(private a: ColorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, colorOut: Color): boolean {
        if (frame === 0) {
            this.a.GetValue(0, globals, colorOut);
        }
        return false;
    }
}

// Added in MP2
export class CEInitialSwitch implements ColorElement {
    constructor(private a: ColorElement, private b: ColorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, colorOut: Color): boolean {
        if (frame === 0)
            this.a.GetValue(frame, globals, colorOut);
        else
            this.b.GetValue(frame, globals, colorOut);
        return false;
    }
}

// Added in MP2
export class CEMultiply implements ColorElement {
    constructor(private a: ColorElement, private b: ColorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, colorOut: Color): boolean {
        this.a.GetValue(frame, globals, colorOut);
        this.b.GetValue(frame, globals, scratchColor);
        colorMult(colorOut, colorOut, scratchColor);
        return false;
    }
}

// Added in MP2
export class CEVRTC implements ColorElement {
    constructor(private a: VectorElement, private b: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, colorOut: Color): boolean {
        this.a.GetValue(frame, globals, scratchVec3);
        const b = { value: 1.0 };
        this.b.GetValue(frame, globals, b);
        colorOut.r = saturate(scratchVec3[0]);
        colorOut.g = saturate(scratchVec3[1]);
        colorOut.b = saturate(scratchVec3[2]);
        colorOut.a = saturate(b.value);
        return false;
    }
}

export function GetColorElement(stream: InputStream): ColorElement | null {
    const type = stream.readFourCC();
    switch (type) {
    case 'KEYE':
    case 'KEYP':
        return new CEKeyframeEmitter(stream);
    case 'KEYF':
        return new CEKeyframeFunction(stream);
    case 'CNST': {
        const a = GetRealElement(stream);
        const b = GetRealElement(stream);
        const c = GetRealElement(stream);
        const d = GetRealElement(stream);
        if (a!.IsConstant() && b!.IsConstant() && c!.IsConstant() && d!.IsConstant()) {
            const av = { value: 0 };
            const bv = { value: 0 };
            const cv = { value: 0 };
            const dv = { value: 0 };
            a!.GetValue(0, defaultParticleGlobals, av);
            b!.GetValue(0, defaultParticleGlobals, bv);
            c!.GetValue(0, defaultParticleGlobals, cv);
            d!.GetValue(0, defaultParticleGlobals, dv);
            return new CEFastConstant(av.value, bv.value, cv.value, dv.value);
        } else {
            return new CEConstant(a!, b!, c!, d!);
        }
    }
    case 'CHAN': {
        const a = GetColorElement(stream);
        const b = GetColorElement(stream);
        const c = GetIntElement(stream);
        return new CETimeChain(a!, b!, c!);
    }
    case 'CFDE': {
        const a = GetColorElement(stream);
        const b = GetColorElement(stream);
        const c = GetRealElement(stream);
        const d = GetRealElement(stream);
        return new CEFadeEnd(a!, b!, c!, d!);
    }
    case 'FADE': {
        const a = GetColorElement(stream);
        const b = GetColorElement(stream);
        const c = GetRealElement(stream);
        return new CEFade(a!, b!, c!);
    }
    case 'PULS': {
        const a = GetIntElement(stream);
        const b = GetIntElement(stream);
        const c = GetColorElement(stream);
        const d = GetColorElement(stream);
        return new CEPulse(a!, b!, c!, d!);
    }
    case 'MDAO': {
        const a = GetColorElement(stream);
        const b = GetRealElement(stream);
        return new CEModulateAlpha(a!, b!);
    }
    case 'PCOL':
        return new CEParticleColor();
    case 'KPIN': {
        const a = GetColorElement(stream);
        return new CEKPIN(a!);
    }
    case 'ISWT': {
        const a = GetColorElement(stream);
        const b = GetColorElement(stream);
        return new CEInitialSwitch(a!, b!);
    }
    case 'MULT': {
        const a = GetColorElement(stream);
        const b = GetColorElement(stream);
        return new CEMultiply(a!, b!);
    }
    case 'VRTC': {
        const a = GetVectorElement(stream);
        const b = GetRealElement(stream);
        return new CEVRTC(a!, b!);
    }
    case 'NONE':
        return null;
    default:
        throw `unrecognized element type ${type}`;
    }
}
