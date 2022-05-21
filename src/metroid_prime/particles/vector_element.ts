import { vec3 } from 'gl-matrix';
import { defaultParticleGlobals, ParticleGlobals } from './base_generator';
import { InputStream } from '../stream';
import { GetRealElement, RealElement } from './real_element';
import { GetIntElement, IntElement } from './int_element';
import { ColorElement, GetColorElement } from './color_element';
import { MathConstants, Vec3UnitX, Vec3UnitY, Vec3UnitZ } from '../../MathHelpers';
import { colorNewFromRGBA } from '../../Color';
import { BaseKeyframeEmitter, BaseKeyframeFunction } from './base_keyframes';

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchColor = colorNewFromRGBA(1.0, 1.0, 1.0, 1.0);

export interface VectorElement {
    GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean;
    IsFastConstant(): boolean;
}

export class VEKeyframeEmitter extends BaseKeyframeEmitter<vec3, vec3> implements VectorElement {
    ReadKey(stream: InputStream): vec3 {
        return stream.readVec3(vec3.create());
    }

    AssignValue(vecOut: vec3, key: vec3): void {
        vec3.copy(vecOut, key);
    }

    LerpValue(vecOut: vec3, keyA: vec3, keyB: vec3, t: number): void {
        vec3.lerp(vecOut, keyA, keyB, t);
    }

    IsFastConstant(): boolean { return false; }
}

export class VEKeyframeFunction extends BaseKeyframeFunction<vec3, vec3> implements VectorElement {
    ReadKey(stream: InputStream): vec3 {
        return stream.readVec3(vec3.create());
    }

    AssignValue(vecOut: vec3, key: vec3): void {
        vec3.copy(vecOut, key);
    }

    LerpValue(vecOut: vec3, keyA: vec3, keyB: vec3, t: number): void {
        vec3.lerp(vecOut, keyA, keyB, t);
    }

    IsFastConstant(): boolean { return false; }
}

export class VECone implements VectorElement {
    xVec: vec3;
    yVec: vec3;

    constructor(private direction: VectorElement, private magnitude: RealElement) {
        const n = vec3.create();
        this.direction.GetValue(0, defaultParticleGlobals, n);
        const normal = vec3.normalize(vec3.create(), n);
        if (normal[0] > 0.8)
            this.xVec = vec3.cross(n, n, Vec3UnitY);
        else
            this.xVec = vec3.cross(n, n, Vec3UnitX);
        this.yVec = vec3.cross(normal, normal, this.xVec);
    }

    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        const magnitude = { value: 0 };
        this.magnitude.GetValue(frame, globals, magnitude);
        magnitude.value = Math.min(1.0, magnitude.value);
        this.direction.GetValue(frame, globals, vecOut);

        let randX: number, randY: number;
        do {
            randX = (Math.random() - 0.5) * 2.0 * magnitude.value;
            randY = (Math.random() - 0.5) * 2.0 * magnitude.value;
        } while (randX * randX + randY * randY > 1.0);

        vec3.add(vecOut,
            vec3.add(scratchVec3a,
                vec3.scale(scratchVec3a, this.xVec, randX),
                vec3.scale(scratchVec3b, this.yVec, randY)),
            vecOut);
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

export class VETimeChain implements VectorElement {
    constructor(private a: VectorElement, private b: VectorElement, private swFrame: IntElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        const swFrame = { value: 0 };
        this.swFrame.GetValue(frame, globals, swFrame);
        if (frame >= swFrame.value)
            return this.b.GetValue(frame, globals, vecOut);
        else
            return this.a.GetValue(frame, globals, vecOut);
    }

    IsFastConstant(): boolean { return false; }
}

export class VEAngleCone implements VectorElement {
    constructor(private angleXBias: RealElement, private angleYBias: RealElement,
                private angleXRange: RealElement, private angleYRange: RealElement,
                private magnitude: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        const angleXBias = { value: 0 };
        const angleYBias = { value: 0 };
        const angleXRange = { value: 0 };
        const angleYRange = { value: 0 };
        this.angleXBias.GetValue(frame, globals, angleXBias);
        this.angleYBias.GetValue(frame, globals, angleYBias);
        this.angleXRange.GetValue(frame, globals, angleXRange);
        this.angleYRange.GetValue(frame, globals, angleYRange);

        const xAngle = MathConstants.DEG_TO_RAD * (angleXRange.value / 2.0 - Math.random() * angleXRange.value + angleXBias.value);
        const yAngle = MathConstants.DEG_TO_RAD * (angleYRange.value / 2.0 - Math.random() * angleYRange.value + angleYBias.value);

        const magnitude = { value: 0 };
        this.magnitude.GetValue(frame, globals, magnitude);
        vecOut[0] = Math.cos(xAngle) * -Math.sin(yAngle) * magnitude.value;
        vecOut[1] = Math.sin(xAngle) * magnitude.value;
        vecOut[2] = Math.cos(xAngle) * Math.cos(yAngle) * magnitude.value;
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

export class VEAdd implements VectorElement {
    constructor(private a: VectorElement, private b: VectorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        this.a.GetValue(frame, globals, vecOut);
        this.b.GetValue(frame, globals, scratchVec3a);
        vec3.add(vecOut, vecOut, scratchVec3a);
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

export class VECircleCluster implements VectorElement {
    xVec: vec3;
    yVec: vec3;
    deltaAngle: number;

    constructor(private center: VectorElement, direction: VectorElement, angleDiv: IntElement,
                private magnitude: RealElement) {
        const aDiv = { value: 0 };
        angleDiv.GetValue(0, defaultParticleGlobals, aDiv);
        this.deltaAngle = MathConstants.DEG_TO_RAD * (360.0 / aDiv.value);

        const dir = vec3.create();
        direction.GetValue(0, defaultParticleGlobals, dir);
        vec3.normalize(dir, dir);
        if (dir[0] > 0.8)
            this.xVec = vec3.cross(vec3.create(), dir, vec3.fromValues(0.0, 1.0, 0.0));
        else
            this.xVec = vec3.cross(vec3.create(), dir, vec3.fromValues(1.0, 0.0, 0.0));
        this.yVec = vec3.cross(dir, dir, this.xVec);
    }

    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        this.center.GetValue(frame, globals, vecOut);

        const curAngle = frame * this.deltaAngle;
        const x = vec3.scale(scratchVec3a, this.xVec, Math.cos(curAngle));
        const y = vec3.scale(scratchVec3b, this.yVec, Math.sin(curAngle));
        vec3.add(vecOut, vec3.add(scratchVec3a, x, y), vecOut);

        const magnitude = { value: 0 };
        this.magnitude.GetValue(frame, globals, magnitude);
        magnitude.value *= vec3.length(vecOut);
        vecOut[0] += magnitude.value * Math.random();
        vecOut[1] += magnitude.value * Math.random();
        vecOut[2] += magnitude.value * Math.random();
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

export class VEConstant implements VectorElement {
    constructor(private a: RealElement, private b: RealElement, private c: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        const a = { value: 0 };
        const b = { value: 0 };
        const c = { value: 0 };
        this.a.GetValue(frame, globals, a);
        this.b.GetValue(frame, globals, b);
        this.c.GetValue(frame, globals, c);
        vecOut[0] = a.value;
        vecOut[1] = b.value;
        vecOut[2] = c.value;
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

export class VEFastConstant implements VectorElement {
    val: vec3;

    constructor(a: number, b: number, c: number) {
        this.val = vec3.fromValues(a, b, c);
    }

    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        vec3.copy(vecOut, this.val);
        return false;
    }

    IsFastConstant(): boolean { return true; }
}

export class VECircle implements VectorElement {
    xVec: vec3;
    yVec: vec3;

    constructor(private center: VectorElement, normal: VectorElement, private angleConstant: RealElement,
                private angleLinear: RealElement, private radius: RealElement) {
        const n = vec3.create();
        normal.GetValue(0, defaultParticleGlobals, n);
        vec3.normalize(n, n);
        if (n[0] > 0.8)
            this.xVec = vec3.cross(vec3.create(), n, vec3.fromValues(0.0, 1.0, 0.0));
        else
            this.xVec = vec3.cross(vec3.create(), n, vec3.fromValues(1.0, 0.0, 0.0));
        this.yVec = vec3.cross(n, n, this.xVec);
    }

    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        const angleConstant = { value: 0 };
        const angleLinear = { value: 0 };
        const radius = { value: 0 };
        this.angleConstant.GetValue(frame, globals, angleConstant);
        this.angleLinear.GetValue(frame, globals, angleLinear);
        this.radius.GetValue(frame, globals, radius);

        const curAngle = MathConstants.DEG_TO_RAD * (angleLinear.value * frame + angleConstant.value);

        this.center.GetValue(frame, globals, vecOut);

        const x = vec3.scale(scratchVec3a, this.xVec, radius.value * Math.cos(curAngle));
        const y = vec3.scale(scratchVec3b, this.yVec, radius.value * Math.sin(curAngle));

        vec3.add(vecOut, vec3.add(scratchVec3a, x, y), vecOut);
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

export class VEMultiply implements VectorElement {
    constructor(private a: VectorElement, private b: VectorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        this.a.GetValue(frame, globals, vecOut);
        this.b.GetValue(frame, globals, scratchVec3a);
        vec3.mul(vecOut, vecOut, scratchVec3a);
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

export class VERealToVector implements VectorElement {
    constructor(private a: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        const a = { value: 0 };
        this.a.GetValue(frame, globals, a);
        vecOut[0] = a.value;
        vecOut[1] = a.value;
        vecOut[2] = a.value;
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

export class VEPulse implements VectorElement {
    constructor(private aDuration: IntElement, private bDuration: IntElement,
                private a: VectorElement, private b: VectorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        const aDuration = { value: 0 };
        const bDuration = { value: 0 };
        this.aDuration.GetValue(frame, globals, aDuration);
        this.bDuration.GetValue(frame, globals, bDuration);
        let end = aDuration.value + bDuration.value + 1;
        if (end < 0)
            end = 1;

        if (bDuration.value < 1 || frame % end <= aDuration.value)
            this.a.GetValue(frame, globals, vecOut);
        else
            this.b.GetValue(frame, globals, vecOut);

        return false;
    }

    IsFastConstant(): boolean { return false; }
}

export class VEParticleVelocity implements VectorElement {
    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        vec3.copy(vecOut, globals.currentParticle.vel);
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

export class VEParticlePrevLocation implements VectorElement {
    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        vec3.copy(vecOut, globals.currentParticle.prevPos);
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

export class VEParticleLocation implements VectorElement {
    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        vec3.copy(vecOut, globals.currentParticle.pos);
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

export class VEParticleSystemOrientationFront implements VectorElement {
    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        const mat = globals.currentParticleSystem.GetOrientation();
        vecOut[0] = mat[4];
        vecOut[1] = mat[5];
        vecOut[2] = mat[6];
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

export class VEParticleSystemOrientationUp implements VectorElement {
    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        const mat = globals.currentParticleSystem.GetOrientation();
        vecOut[0] = mat[8];
        vecOut[1] = mat[9];
        vecOut[2] = mat[10];
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

export class VEParticleSystemOrientationRight implements VectorElement {
    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        const mat = globals.currentParticleSystem.GetOrientation();
        vecOut[0] = mat[0];
        vecOut[1] = mat[1];
        vecOut[2] = mat[2];
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

export class VEParticleSystemTranslation implements VectorElement {
    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        vec3.copy(vecOut, globals.currentParticleSystem.GetTranslation());
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

export class VESubtract implements VectorElement {
    constructor(private a: VectorElement, private b: VectorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        this.a.GetValue(frame, globals, vecOut);
        this.b.GetValue(frame, globals, scratchVec3a);
        vec3.sub(vecOut, vecOut, scratchVec3a);
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

export class VEColorToVector implements VectorElement {
    constructor(private a: ColorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        this.a.GetValue(frame, globals, scratchColor);
        vecOut[0] = scratchColor.r;
        vecOut[1] = scratchColor.g;
        vecOut[2] = scratchColor.b;
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

// Added in MP2
export class VEParticleNormalizedVelocity implements VectorElement {
    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        const particle = globals.currentParticle;
        const velSq = vec3.squaredLength(particle.vel);
        if (velSq <= MathConstants.EPSILON) {
            const delta = vec3.sub(scratchVec3a, particle.pos, particle.prevPos);
            const deltaSq = vec3.squaredLength(delta);
            if (deltaSq < MathConstants.EPSILON) {
                vec3.copy(vecOut, Vec3UnitZ);
            } else {
                vec3.scale(vecOut, delta, 1.0 / Math.sqrt(deltaSq));
            }
        } else {
            vec3.scale(vecOut, particle.vel, 1.0 / Math.sqrt(velSq));
        }
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

// Added in MP2
export class VERandomVector implements VectorElement {
    constructor(private mag: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        const mag = { value: 1.0 }
        this.mag.GetValue(frame, globals, mag);
        vec3.set(vecOut, Math.random() * 2.0 - 1.0, Math.random() * 2.0 - 1.0, Math.random() * 2.0 - 1.0);
        vec3.normalize(vecOut, vecOut);
        vec3.scale(vecOut, vecOut, mag.value);
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

// Added in MP2
export class VEParticleAccessParam1 implements VectorElement {
    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        vecOut[0] = globals.particleAccessParameters![0].value;
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

// Added in MP2
export class VEParticleAccessParam2 implements VectorElement {
    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        vecOut[0] = globals.particleAccessParameters![1].value;
        vecOut[1] = vecOut[0];
        vecOut[2] = vecOut[0];
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

// Added in MP2
export class VEParticleAccessParam3 implements VectorElement {
    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        vecOut[0] = globals.particleAccessParameters![2].value;
        vecOut[1] = vecOut[0];
        vecOut[2] = vecOut[0];
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

// Added in MP2
export class VEParticleAccessParam4 implements VectorElement {
    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        vecOut[0] = globals.particleAccessParameters![3].value;
        vecOut[1] = vecOut[0];
        vecOut[2] = vecOut[0];
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

// Added in MP2
export class VEParticleAccessParam5 implements VectorElement {
    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        vecOut[0] = globals.particleAccessParameters![4].value;
        vecOut[1] = vecOut[0];
        vecOut[2] = vecOut[0];
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

// Added in MP2
export class VEParticleAccessParam6 implements VectorElement {
    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        vecOut[0] = globals.particleAccessParameters![5].value;
        vecOut[1] = vecOut[0];
        vecOut[2] = vecOut[0];
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

// Added in MP2
export class VEParticleAccessParam7 implements VectorElement {
    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        vecOut[0] = globals.particleAccessParameters![6].value;
        vecOut[1] = vecOut[0];
        vecOut[2] = vecOut[0];
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

// Added in MP2
export class VEParticleAccessParam8 implements VectorElement {
    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        vecOut[0] = globals.particleAccessParameters![7].value;
        vecOut[1] = vecOut[0];
        vecOut[2] = vecOut[0];
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

// Added in MP2
export class VEKPIN implements VectorElement {
    constructor(private a: VectorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        if (frame === 0) {
            this.a.GetValue(0, globals, vecOut);
        }
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

// Added in MP2
export class VENormalize implements VectorElement {
    constructor(private a: VectorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, vecOut: vec3): boolean {
        this.a.GetValue(0, globals, vecOut);
        const length = vec3.length(vecOut);
        if (length > MathConstants.EPSILON) {
            vec3.scale(vecOut, vecOut, 1.0 / length);
        }
        return false;
    }

    IsFastConstant(): boolean { return false; }
}

export function GetVectorElement(stream: InputStream): VectorElement | null {
    const type = stream.readFourCC();
    switch (type) {
    case 'CONE': {
        const a = GetVectorElement(stream);
        const b = GetRealElement(stream);
        return new VECone(a!, b!);
    }
    case 'CHAN': {
        const a = GetVectorElement(stream);
        const b = GetVectorElement(stream);
        const c = GetIntElement(stream);
        return new VETimeChain(a!, b!, c!);
    }
    case 'ANGC': {
        const a = GetRealElement(stream);
        const b = GetRealElement(stream);
        const c = GetRealElement(stream);
        const d = GetRealElement(stream);
        const e = GetRealElement(stream);
        return new VEAngleCone(a!, b!, c!, d!, e!);
    }
    case 'ADD_': {
        const a = GetVectorElement(stream);
        const b = GetVectorElement(stream);
        return new VEAdd(a!, b!);
    }
    case 'CCLU': {
        const a = GetVectorElement(stream);
        const b = GetVectorElement(stream);
        const c = GetIntElement(stream);
        const d = GetRealElement(stream);
        return new VECircleCluster(a!, b!, c!, d!);
    }
    case 'CNST': {
        const a = GetRealElement(stream);
        const b = GetRealElement(stream);
        const c = GetRealElement(stream);
        if (a!.IsConstant() && b!.IsConstant() && c!.IsConstant()) {
            const av = { value: 0 };
            const bv = { value: 0 };
            const cv = { value: 0 };
            a!.GetValue(0, defaultParticleGlobals, av);
            b!.GetValue(0, defaultParticleGlobals, bv);
            c!.GetValue(0, defaultParticleGlobals, cv);
            return new VEFastConstant(av.value, bv.value, cv.value);
        } else {
            return new VEConstant(a!, b!, c!);
        }
    }
    case 'CIRC': {
        const a = GetVectorElement(stream);
        const b = GetVectorElement(stream);
        const c = GetRealElement(stream);
        const d = GetRealElement(stream);
        const e = GetRealElement(stream);
        return new VECircle(a!, b!, c!, d!, e!);
    }
    case 'KEYE':
    case 'KEYP':
        return new VEKeyframeEmitter(stream);
    case 'KEYF':
        return new VEKeyframeFunction(stream);
    case 'MULT': {
        const a = GetVectorElement(stream);
        const b = GetVectorElement(stream);
        return new VEMultiply(a!, b!);
    }
    case 'RTOV': {
        const a = GetRealElement(stream);
        return new VERealToVector(a!);
    }
    case 'PULS': {
        const a = GetIntElement(stream);
        const b = GetIntElement(stream);
        const c = GetVectorElement(stream);
        const d = GetVectorElement(stream);
        return new VEPulse(a!, b!, c!, d!);
    }
    case 'PVEL':
        return new VEParticleVelocity();
    case 'PLCO':
        return new VEParticlePrevLocation();
    case 'PLOC':
        return new VEParticleLocation();
    case 'PNCV':
        return new VEParticleNormalizedVelocity();
    case 'PSOF':
        return new VEParticleSystemOrientationFront();
    case 'PSOU':
        return new VEParticleSystemOrientationUp();
    case 'PSOR':
        return new VEParticleSystemOrientationRight();
    case 'PSTR':
        return new VEParticleSystemTranslation();
    case 'SUB_': {
        const a = GetVectorElement(stream);
        const b = GetVectorElement(stream);
        return new VESubtract(a!, b!);
    }
    case 'CTVC': {
        const a = GetColorElement(stream);
        return new VEColorToVector(a!);
    }
    case 'RNDV': {
        const a = GetRealElement(stream);
        return new VERandomVector(a!);
    }
    case 'PAP1':
        return new VEParticleAccessParam1();
    case 'PAP2':
        return new VEParticleAccessParam2();
    case 'PAP3':
        return new VEParticleAccessParam3();
    case 'PAP4':
        return new VEParticleAccessParam4();
    case 'PAP5':
        return new VEParticleAccessParam5();
    case 'PAP6':
        return new VEParticleAccessParam6();
    case 'PAP7':
        return new VEParticleAccessParam7();
    case 'PAP8':
        return new VEParticleAccessParam8();
    case 'KPIN': {
        const a = GetVectorElement(stream);
        return new VEKPIN(a!);
    }
    case 'NORM': {
        const a = GetVectorElement(stream);
        return new VENormalize(a!);
    }
    case 'NONE':
        return null;
    default:
        throw `unrecognized element type ${type}`;
    }
}
