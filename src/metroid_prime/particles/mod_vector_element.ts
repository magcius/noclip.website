import { vec3 } from 'gl-matrix';
import { defaultParticleGlobals, GetBool, ParticleGlobals } from './base_generator';
import { GetVectorElement, VectorElement } from './vector_element';
import { GetRealElement, RealElement } from './real_element';
import { GetIntElement, IntElement } from './int_element';
import { InputStream } from '../stream';
import { AABB } from '../../Geometry';

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchAABB = new AABB();

export interface ModVectorElement {
    GetValue(frame: number, globals: ParticleGlobals, vel: vec3, pos: vec3): boolean;
}

abstract class MVEImplosionBase implements ModVectorElement {
    constructor(private implPoint: VectorElement, protected magScale: RealElement, private maxMag: RealElement,
                private minMag: RealElement, private enableMinMag: boolean) {
    }

    abstract CalcMagScale(frame: number, globals: ParticleGlobals, deltaMag: number): number;

    public GetValue(frame: number, globals: ParticleGlobals, vel: vec3, pos: vec3): boolean {
        this.implPoint.GetValue(frame, globals, scratchVec3a);

        vec3.sub(scratchVec3a, scratchVec3a, pos);
        const deltaMag = vec3.length(scratchVec3a);

        const maxMag = { value: 0 };
        this.maxMag.GetValue(frame, globals, maxMag);
        if (deltaMag > maxMag.value)
            return false;

        const minMag = { value: 0 };
        this.minMag.GetValue(frame, globals, minMag);
        if (this.enableMinMag && deltaMag < minMag.value)
            return true;

        if (deltaMag === 0.0)
            return false;

        const magScale = this.CalcMagScale(frame, globals, deltaMag);
        vel[0] += scratchVec3a[0] * magScale;
        vel[1] += scratchVec3a[1] * magScale;
        vel[2] += scratchVec3a[2] * magScale;
        return false;
    }
}

export class MVEExponentialImplosion extends MVEImplosionBase {
    CalcMagScale(frame: number, globals: ParticleGlobals, deltaMag: number): number {
        const magScale = { value: 0 };
        this.magScale.GetValue(frame, globals, magScale);
        return magScale.value;
    }
}

export class MVELinearImplosion extends MVEImplosionBase {
    CalcMagScale(frame: number, globals: ParticleGlobals, deltaMag: number): number {
        const magScale = { value: 0 };
        this.magScale.GetValue(frame, globals, magScale);
        return magScale.value / deltaMag;
    }
}

export class MVEImplosion extends MVELinearImplosion {
}

export class MVETimeChain implements ModVectorElement {
    constructor(private a: ModVectorElement, private b: ModVectorElement, private swFrame: IntElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, vel: vec3, pos: vec3): boolean {
        const swFrame = { value: 0 };
        this.swFrame.GetValue(frame, globals, swFrame);
        if (frame >= swFrame.value)
            return this.b.GetValue(frame, globals, vel, pos);
        else
            return this.a.GetValue(frame, globals, vel, pos);
    }
}

export class MVEBounce implements ModVectorElement {
    planePrecomputed: boolean = false;
    planeValidatedNormal: vec3 = vec3.create();
    planeD: number = 0.0;

    constructor(private planePoint: VectorElement, private planeNormal: VectorElement,
                private friction: RealElement, private restitution: RealElement, private dieOnPenetrate: boolean) {
        if (planePoint.IsFastConstant() && planeNormal.IsFastConstant()) {
            /* Precompute Hesse normal form of plane (for penetration testing)
             * https://en.wikipedia.org/wiki/Hesse_normal_form */
            this.planePrecomputed = true;
            this.planeNormal.GetValue(0, defaultParticleGlobals, this.planeValidatedNormal);
            vec3.normalize(this.planeValidatedNormal, this.planeValidatedNormal);

            this.planePoint.GetValue(0, defaultParticleGlobals, scratchVec3a);
            this.planeD = vec3.dot(this.planeValidatedNormal, scratchVec3a);
        }
    }

    public GetValue(frame: number, globals: ParticleGlobals, vel: vec3, pos: vec3): boolean {
        if (!this.planePrecomputed) {
            /* Compute Hesse normal form of plane (for penetration testing) */
            this.planeNormal.GetValue(frame, globals, this.planeValidatedNormal);
            vec3.normalize(this.planeValidatedNormal, this.planeValidatedNormal);

            this.planePoint.GetValue(frame, globals, scratchVec3a);
            this.planeD = vec3.dot(this.planeValidatedNormal, scratchVec3a);
        }

        const dot = vec3.dot(this.planeValidatedNormal, pos);
        if (dot - this.planeD > 0.0)
            return false;
        else if (this.dieOnPenetrate)
            return true;

        /* Deflection event */

        if (vec3.dot(vel, this.planeValidatedNormal) >= 0.0)
            return false;

        const delta = vec3.sub(scratchVec3a, pos, vel);
        const fac = -(vec3.dot(delta, this.planeValidatedNormal) - this.planeD) / vec3.dot(vel, this.planeValidatedNormal) - 1.0;
        pos[0] += vel[0] * fac;
        pos[1] += vel[1] * fac;
        pos[2] += vel[2] * fac;

        const restitution = { value: 0 };
        this.restitution.GetValue(frame, globals, restitution);
        vel[0] -= vel[0] * restitution.value;
        vel[1] -= vel[1] * restitution.value;
        vel[2] -= vel[2] * restitution.value;

        const friction = { value: 0 };
        this.friction.GetValue(frame, globals, friction);
        const frictionFac = (1.0 + friction.value) * vec3.dot(this.planeValidatedNormal, vel);
        vel[0] -= this.planeValidatedNormal[0] * frictionFac;
        vel[1] -= this.planeValidatedNormal[1] * frictionFac;
        vel[2] -= this.planeValidatedNormal[2] * frictionFac;

        return false;
    }

}

export class MVEConstant implements ModVectorElement {
    constructor(private a: RealElement, private b: RealElement, private c: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, vel: vec3, pos: vec3): boolean {
        const a = { value: 0 };
        const b = { value: 0 };
        const c = { value: 0 };
        this.a.GetValue(frame, globals, a);
        this.b.GetValue(frame, globals, b);
        this.c.GetValue(frame, globals, c);
        vel[0] = a.value;
        vel[1] = b.value;
        vel[2] = c.value;
        return false;
    }
}

export class MVEFastConstant implements ModVectorElement {
    val: vec3;

    constructor(a: number, b: number, c: number) {
        this.val = vec3.fromValues(a, b, c);
    }

    public GetValue(frame: number, globals: ParticleGlobals, vel: vec3, pos: vec3): boolean {
        vec3.copy(vel, this.val);
        return false;
    }
}

export class MVEGravity implements ModVectorElement {
    constructor(private a: VectorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, vel: vec3, pos: vec3): boolean {
        this.a.GetValue(frame, globals, scratchVec3a);
        vec3.add(vel, vel, scratchVec3a);
        return false;
    }
}

export class MVEExplode implements ModVectorElement {
    constructor(private a: RealElement, private b: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, vel: vec3, pos: vec3): boolean {
        if (frame === 0) {
            scratchVec3a[0] = Math.random() - 0.5;
            scratchVec3a[1] = Math.random() - 0.5;
            scratchVec3a[2] = Math.random() - 0.5;
            vec3.normalize(scratchVec3a, scratchVec3a);
            const a = { value: 0 };
            this.a.GetValue(frame, globals, a);
            vec3.scale(vel, scratchVec3a, a.value);
        } else {
            const b = { value: 0 };
            this.b.GetValue(frame, globals, b);
            vec3.scale(vel, vel, b.value);
        }
        return false;
    }
}

export class MVESetPosition implements ModVectorElement {
    constructor(private a: VectorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, vel: vec3, pos: vec3): boolean {
        this.a.GetValue(frame, globals, pos);
        return false;
    }
}

export class MVEPulse implements ModVectorElement {
    constructor(private aDuration: IntElement, private bDuration: IntElement,
                private a: ModVectorElement, private b: ModVectorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, vel: vec3, pos: vec3): boolean {
        const aDuration = { value: 0 };
        const bDuration = { value: 0 };
        this.aDuration.GetValue(frame, globals, aDuration);
        this.bDuration.GetValue(frame, globals, bDuration);
        let end = aDuration.value + bDuration.value + 1;
        if (end < 0)
            end = 1;

        if (bDuration.value < 1 || frame % end <= aDuration.value)
            this.a.GetValue(frame, globals, vel, pos);
        else
            this.b.GetValue(frame, globals, vel, pos);

        return false;
    }
}

export class MVEWind implements ModVectorElement {
    constructor(private velocity: VectorElement, private factor: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, vel: vec3, pos: vec3): boolean {
        this.velocity.GetValue(frame, globals, scratchVec3a);
        const factor = { value: 0 };
        this.factor.GetValue(frame, globals, factor);
        vec3.add(vel, vel, vec3.scale(scratchVec3a, vec3.sub(scratchVec3a, scratchVec3a, vel), factor.value));
        return false;
    }
}

export class MVESwirl implements ModVectorElement {
    constructor(private helixPoint: VectorElement, private curveBinormal: VectorElement,
                private filterGain: RealElement, private tangentialVelocity: RealElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, vel: vec3, pos: vec3): boolean {
        this.helixPoint.GetValue(frame, globals, scratchVec3a);
        this.curveBinormal.GetValue(frame, globals, scratchVec3b);

        vec3.sub(scratchVec3a, scratchVec3a, pos);
        vec3.sub(scratchVec3a,
            scratchVec3a,
            vec3.scale(scratchVec3c, scratchVec3b, vec3.dot(scratchVec3a, scratchVec3b)));

        const filterGain = { value: 0 };
        const tangentialVelocity = { value: 0 };
        this.filterGain.GetValue(frame, globals, filterGain);
        this.tangentialVelocity.GetValue(frame, globals, tangentialVelocity);

        vec3.add(scratchVec3a,
            vec3.scale(scratchVec3a, vec3.cross(scratchVec3a, scratchVec3a, scratchVec3b), tangentialVelocity.value),
            vec3.scale(scratchVec3b, scratchVec3b, vec3.dot(scratchVec3b, vel)));
        vec3.lerp(vel, vel, scratchVec3a, filterGain.value);
        return false;
    }
}

// Added in MP2
export class MVEBOXV implements ModVectorElement {
    constructor(private x4: VectorElement, private x8: VectorElement,
                private xc: ModVectorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, vel: vec3, pos: vec3): boolean {
        const boxCenter = scratchVec3a;
        const boxExtent = scratchVec3b;
        this.x4.GetValue(frame, globals, boxCenter);
        this.x8.GetValue(frame, globals, boxExtent);
        scratchAABB.set(
            boxCenter[0] - boxExtent[0] * 0.5, boxCenter[1] - boxExtent[1] * 0.5, boxCenter[2] - boxExtent[2] * 0.5,
            boxCenter[0] + boxExtent[0] * 0.5, boxCenter[1] + boxExtent[1] * 0.5, boxCenter[2] + boxExtent[2] * 0.5);
        if (scratchAABB.containsPoint(pos)) {
            this.xc.GetValue(frame, globals, vel, pos);
        }
        return false;
    }
}

// Added in MP2
export class MVESPHV implements ModVectorElement {
    constructor(private x4: VectorElement, private x8: RealElement,
                private xc: ModVectorElement) {
    }

    public GetValue(frame: number, globals: ParticleGlobals, vel: vec3, pos: vec3): boolean {
        // TODO: Implement
        return false;
    }
}

export function GetModVectorElement(stream: InputStream): ModVectorElement | null {
    const type = stream.readFourCC();
    switch (type) {
    case 'IMPL': {
        const a = GetVectorElement(stream);
        const b = GetRealElement(stream);
        const c = GetRealElement(stream);
        const d = GetRealElement(stream);
        const e = GetBool(stream);
        return new MVEImplosion(a!, b!, c!, d!, e);
    }
    case 'EMPL': {
        const a = GetVectorElement(stream);
        const b = GetRealElement(stream);
        const c = GetRealElement(stream);
        const d = GetRealElement(stream);
        const e = GetBool(stream);
        return new MVEExponentialImplosion(a!, b!, c!, d!, e);
    }
    case 'CHAN': {
        const a = GetModVectorElement(stream);
        const b = GetModVectorElement(stream);
        const c = GetIntElement(stream);
        return new MVETimeChain(a!, b!, c!);
    }
    case 'BNCE': {
        const a = GetVectorElement(stream);
        const b = GetVectorElement(stream);
        const c = GetRealElement(stream);
        const d = GetRealElement(stream);
        const e = GetBool(stream);
        return new MVEBounce(a!, b!, c!, d!, e);
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
            return new MVEFastConstant(av.value, bv.value, cv.value);
        } else {
            return new MVEConstant(a!, b!, c!);
        }
    }
    case 'GRAV': {
        const a = GetVectorElement(stream);
        return new MVEGravity(a!);
    }
    case 'EXPL': {
        const a = GetRealElement(stream);
        const b = GetRealElement(stream);
        return new MVEExplode(a!, b!);
    }
    case 'SPOS': {
        const a = GetVectorElement(stream);
        return new MVESetPosition(a!);
    }
    case 'LMPL': {
        const a = GetVectorElement(stream);
        const b = GetRealElement(stream);
        const c = GetRealElement(stream);
        const d = GetRealElement(stream);
        const e = GetBool(stream);
        return new MVELinearImplosion(a!, b!, c!, d!, e);
    }
    case 'PULS': {
        const a = GetIntElement(stream);
        const b = GetIntElement(stream);
        const c = GetModVectorElement(stream);
        const d = GetModVectorElement(stream);
        return new MVEPulse(a!, b!, c!, d!);
    }
    case 'WIND': {
        const a = GetVectorElement(stream);
        const b = GetRealElement(stream);
        return new MVEWind(a!, b!);
    }
    case 'SWRL': {
        const a = GetVectorElement(stream);
        const b = GetVectorElement(stream);
        const c = GetRealElement(stream);
        const d = GetRealElement(stream);
        return new MVESwirl(a!, b!, c!, d!);
    }
    case 'BOXV': {
        const a = GetVectorElement(stream);
        const b = GetVectorElement(stream);
        const c = GetModVectorElement(stream);
        return new MVEBOXV(a!, b!, c!);
    }
    case 'SPHV': {
        const a = GetVectorElement(stream);
        const b = GetRealElement(stream);
        const c = GetModVectorElement(stream);
        return new MVESPHV(a!, b!, c!);
    }
    case 'NONE':
        return null;
    default:
        throw `unrecognized element type ${type}`;
    }
}
