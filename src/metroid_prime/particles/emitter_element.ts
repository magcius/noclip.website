import { mat4, vec3 } from 'gl-matrix';
import { defaultParticleGlobals, GetBool, NumberHolder, ParticleGlobals } from './base_generator';
import { GetVectorElement, VectorElement } from './vector_element';
import { GetRealElement, RealElement } from './real_element';
import { computeModelMatrixSRT, MathConstants, randomRange } from '../../MathHelpers';
import { InputStream } from '../stream';
import { assert } from '../../util';

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();

export interface EmitterElement {
    GetValue(frame: number, globals: ParticleGlobals, posOut: vec3, velOut: vec3): boolean;
}

export class EESimpleEmitter implements EmitterElement {
    constructor(private loc: VectorElement, private vec?: VectorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, posOut: vec3, velOut: vec3): boolean {
        this.loc.GetValue(frame, globals, posOut);

        if (this.vec)
            this.vec.GetValue(frame, globals, velOut);
        else
            vec3.zero(velOut);

        return false;
    }
}

export class EESphere implements EmitterElement {
    constructor(private origin: VectorElement, private radius: RealElement, private velMag: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, posOut: vec3, velOut: vec3): boolean {
        // Borrow velOut storage for origin
        this.origin.GetValue(frame, globals, velOut);
        const radius = { value: 0 };
        this.radius.GetValue(frame, globals, radius);

        posOut[2] = Math.trunc(randomRange(-100, 100)) / 100.0;
        posOut[1] = Math.trunc(randomRange(-100, 100)) / 100.0;
        posOut[0] = Math.trunc(randomRange(-100, 100)) / 100.0;

        vec3.add(posOut, vec3.scale(posOut, vec3.normalize(posOut, posOut), radius.value), velOut);

        vec3.normalize(velOut, vec3.sub(velOut, posOut, velOut));

        const velMag = { value: 0 };
        this.velMag.GetValue(frame, globals, velMag);
        vec3.scale(velOut, velOut, velMag.value);

        return false;
    }
}

export class EEAngleSphere implements EmitterElement {
    constructor(private origin: VectorElement, private radius: RealElement, private velMag: RealElement,
                private angleXBias: RealElement, private angleYBias: RealElement,
                private angleXRange: RealElement, private angleYRange: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, posOut: vec3, velOut: vec3): boolean {
        // Borrow velOut storage for origin
        this.origin.GetValue(frame, globals, velOut);
        const radius = { value: 0 };
        const angleXBias = { value: 0 };
        const angleYBias = { value: 0 };
        const angleXRange = { value: 0 };
        const angleYRange = { value: 0 };
        this.radius.GetValue(frame, globals, radius);
        this.angleXBias.GetValue(frame, globals, angleXBias);
        this.angleYBias.GetValue(frame, globals, angleYBias);
        this.angleXRange.GetValue(frame, globals, angleXRange);
        this.angleYRange.GetValue(frame, globals, angleYRange);

        const angleX = MathConstants.DEG_TO_RAD * (angleXBias.value + angleXRange.value / 2.0 - angleXRange.value * Math.random());
        const angleY = MathConstants.DEG_TO_RAD * (angleYBias.value + angleYRange.value / 2.0 - angleYRange.value * Math.random());
        const cosAngleX = Math.cos(angleX);

        posOut[0] = velOut[0] + radius.value * (-Math.sin(angleY) * cosAngleX);
        posOut[1] = velOut[1] + radius.value * Math.sin(angleX);
        posOut[2] = velOut[2] + radius.value * cosAngleX * cosAngleX;

        vec3.normalize(velOut, vec3.sub(velOut, posOut, velOut));
        const velMag = { value: 0 };
        this.velMag.GetValue(frame, globals, velMag);
        vec3.scale(velOut, velOut, velMag.value);

        return false;
    }
}

// Added in MP2
export class EEELPS implements EmitterElement {
    constructor(private vecA: VectorElement, private vecB: VectorElement, private vecC: VectorElement,
                private real: RealElement, private bool: boolean) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, posOut: vec3, velOut: vec3): boolean {
        // TODO: Reverse this
        return false;
    }
}

// Added in MP2
export class EEPLNE implements EmitterElement {
    x1c: mat4 = mat4.create();
    x4c: NumberHolder = { value: 0.0 };
    x50: number = 0.0;
    x54: number = 0.0;
    x58: number = 0;

    constructor(private x4: VectorElement | null, private x8: VectorElement | null, private xc: VectorElement,
                private x10: RealElement, private x14: RealElement, private x18: RealElement) {
        this.x58 |= 0x40;
        if (x4 && x8 && x4.IsFastConstant() && x8.IsFastConstant()) {
            this.x58 |= 0x80;
            x4.GetValue(0, defaultParticleGlobals, scratchVec3a);
            x8.GetValue(0, defaultParticleGlobals, scratchVec3b);
            vec3.scale(scratchVec3b, scratchVec3b, MathConstants.DEG_TO_RAD);
            computeModelMatrixSRT(this.x1c, 1.0, 1.0, 1.0, scratchVec3b[0], scratchVec3b[1], scratchVec3b[2], scratchVec3a[0], scratchVec3a[1], scratchVec3a[2]);
        }
        if (x18 && x18.IsConstant()) {
            this.x58 |= 0x20;
            x18.GetValue(0, defaultParticleGlobals, this.x4c);
            if (this.x4c.value === 0) {
                this.x58 &= ~0x40;
            } else {
                this.x4c.value *= MathConstants.DEG_TO_RAD;
                // TODO: Reverse weird math functions
            }
        }
    }

    public GetValue(frame: number, globals: ParticleGlobals, posOut: vec3, velOut: vec3): boolean {
        // TODO: Reverse this
        return false;
    }
}

export function GetEmitterElement(stream: InputStream): EmitterElement | null {
    const type = stream.readFourCC();
    switch (type) {
    case 'SETR': {
        let prop = stream.readFourCC();
        assert(prop === 'ILOC');
        const a = GetVectorElement(stream);
        prop = stream.readFourCC();
        assert(prop === 'IVEC');
        const b = GetVectorElement(stream);
        return new EESimpleEmitter(a!, b!);
    }
    case 'SEMR': {
        const a = GetVectorElement(stream);
        const b = GetVectorElement(stream);
        return new EESimpleEmitter(a!, b!);
    }
    case 'SPHE': {
        const a = GetVectorElement(stream);
        const b = GetRealElement(stream);
        const c = GetRealElement(stream);
        return new EESphere(a!, b!, c!);
    }
    case 'ASPH': {
        const a = GetVectorElement(stream);
        const b = GetRealElement(stream);
        const c = GetRealElement(stream);
        const d = GetRealElement(stream);
        const e = GetRealElement(stream);
        const f = GetRealElement(stream);
        const g = GetRealElement(stream);
        return new EEAngleSphere(a!, b!, c!, d!, e!, f!, g!);
    }
    case 'ELPS': {
        const a = GetVectorElement(stream);
        const b = GetVectorElement(stream);
        const c = GetVectorElement(stream);
        const d = GetRealElement(stream);
        const e = GetBool(stream);
        return new EEELPS(a!, b!, c!, d!, e);
    }
    case 'PLNE': {
        const a = GetVectorElement(stream);
        const b = GetVectorElement(stream);
        const c = GetVectorElement(stream);
        const d = GetRealElement(stream);
        const e = GetRealElement(stream);
        const f = GetRealElement(stream);
        return new EEPLNE(a!, b!, c!, d!, e!, f!);
    }
    case 'NONE':
        return null;
    default:
        throw `unrecognized element type ${type}`;
    }
}
