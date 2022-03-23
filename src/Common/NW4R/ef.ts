
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { arrayRemove, assert, assertExists, nArray, readString } from "../../util";
import * as GX from '../../gx/gx_enum';
import { mat4, ReadonlyMat4, ReadonlyVec3, vec3 } from "gl-matrix";
import { Color, colorNewFromRGBA8 } from "../../Color";
import { GXMaterialBuilder } from "../../gx/GXMaterialBuilder";
import { GXMaterial } from "../../gx/gx_material";
import { computeModelMatrixR, isNearZeroVec3, MathConstants, transformVec3Mat4w0, transformVec3Mat4w1 } from "../../MathHelpers";

class EfRandom {
    constructor(public state: number = 0) {
    }

    public copy(other: Readonly<EfRandom>): void {
        this.state = other.state;
    }

    public srand(seed: number = 0): void {
        this.state = seed;
    }

    private next(): void {
        // MSVC
        this.state = (this.state * 214013 + 2531011) >>> 0;
    }

    public rand(): number {
        this.next();
        return this.state >>> 16;
    }

    public randFloat(): number {
        return this.rand() / 65536.0;
    }
}


// Return a random number between 0 and 1.
function get_rndm_f(random: EfRandom): number {
    return random.randFloat();
}

// Return a random number between -1 and 1.
function get_r_zp(random: EfRandom): number {
    return get_rndm_f(random) * 2 - 1;
}

// Return a random number between -0.5 and 0.5.
function get_r_zh(random: EfRandom): number {
    return get_rndm_f(random) - 0.5;
}

class EfParticle {
    public age: number = 0;
    public lifeTime: number = 0;
    public position = vec3.create();
    public velocity = vec3.create();
    public moment: number = 0;

    public init(effectManager: EfEffectManager, emitter: EfEmitter): void {
        const emitterSettings = emitter.resData.emitterSettings;

        if (emitterSettings.lifeTimeRndm !== 0) {
            const lifeTimeRndm = get_rndm_f(emitter.random);
            this.lifeTime = emitter.lifeTime * (1.0 - lifeTimeRndm * emitterSettings.lifeTimeRndm);
        }

        this.age = -1;
        this.moment = 1.0 + (emitter.momentRndm * get_rndm_f(emitter.random));
    }
}

const enum EfEmitterStatus {
    Dead           = 0,
    Alive          = 1 << 0,
    FirstEmission  = 1 << 1,
    SpawnParticles = 1 << 2,
}

const scratchMatrix = mat4.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();

class EfEmitter {
    private aliveParticles: EfParticle[] = [];
    public resData: EfEffectResourceData;
    public effect: EfEffect;

    public simFlags: EmitterSimFlags;
    private rate: number;

    public age: number;
    public status = EfEmitterStatus.Dead;

    private emitterDir = vec3.create();
    private awayFromCenterSpeed: number;
    private awayFromYAxisSpeed: number;
    private directionalSpeed: number;
    private directionalSpread: number;
    private normalDirectionSpeed: number;
    private randomDirectionSpeed: number;
    private initialVelRatio: number;
    
    public lifeTime: number;
    public momentRndm: number;

    // Internal state.
    private volumeParams: number[] = [0, 0, 0, 0, 0, 0];
    private emitCount: number;
    private waitTime: number;
    private rateStepTimer: number;

    public random = new EfRandom();

    constructor(private effectManager: EfEffectManager) {
    }

    public init(effect: EfEffect, resData: EfEffectResourceData): void {
        this.resData = resData;
        this.effect = effect;

        const emitterSettings = this.resData.emitterSettings;
        this.simFlags = emitterSettings.emitterSimFlags;
        this.rate = emitterSettings.rate;
        this.age = 0;
        this.emitCount = 0;
        this.waitTime = emitterSettings.startFrame;
        this.rateStepTimer = 0;
        this.status = EfEmitterStatus.Alive | EfEmitterStatus.FirstEmission | EfEmitterStatus.SpawnParticles;
        for (let i = 0; i < 6; i++)
            this.volumeParams[i] = emitterSettings.volumeParams[i];
        this.awayFromCenterSpeed = emitterSettings.initialVelOmni;
        this.awayFromYAxisSpeed = emitterSettings.initialVelAxis;
        this.directionalSpeed = emitterSettings.initialVelDir;
        this.directionalSpread = emitterSettings.diffuseVelDir;
        this.normalDirectionSpeed = emitterSettings.initialVelNrm;
        this.randomDirectionSpeed = emitterSettings.initialVelRndm;
        vec3.copy(this.emitterDir, emitterSettings.emitterDir);
        this.initialVelRatio = emitterSettings.initialVelRatio;
        this.momentRndm = emitterSettings.momentRndm;

        let randomSeed = emitterSettings.randomSeed;
        if (randomSeed === 0)
            randomSeed = this.effectManager.random.rand();
        this.random.srand(randomSeed);
    }

    public calcParticle(deltaTime: number): void {
        for (let i = 0; i < this.aliveParticles.length; i++) {
            const p = this.aliveParticles[i];

            if (p.age >= p.lifeTime) {
                this.aliveParticles.splice(i, 1);
                this.effectManager.destroyParticle(p);
                i--;
                continue;
            }

            if (p.age === -1)
                p.age++;
            else
                p.age += deltaTime;

            vec3.scaleAndAdd(p.position, p.position, p.velocity, p.moment * deltaTime);
        }
    }

    public calcEmitter(): void {
        if (!(this.status & EfEmitterStatus.Alive))
            return;

        if (!(this.status & EfEmitterStatus.SpawnParticles)) {
            if (this.aliveParticles.length === 0)
                this.status &= ~EfEmitterStatus.Alive;
            return;
        }

        if (this.waitTime > 0.0)
            return;

        const emitterSettings = this.resData.emitterSettings;
        if (!!(emitterSettings.emitterSimFlags & EmitterSimFlags.Forever)) {
            if (this.age < 0) {
                this.status &= ~EfEmitterStatus.SpawnParticles;
                return;
            }
        } else {
            if (this.age >= emitterSettings.maxFrame) {
                this.status &= ~EfEmitterStatus.SpawnParticles;
                return;
            }
        }
    }

    private processTillStartFrame(deltaTime: number): boolean {
        if (this.waitTime <= 0.0)
            return true;

        this.waitTime -= deltaTime;
        return false;
    }

    private calcVelocity(particle: EfParticle, awayFromCenter: ReadonlyVec3, normalDir: ReadonlyVec3, awayFromYAxis: ReadonlyVec3): void {
        vec3.zero(particle.velocity);

        if (this.awayFromCenterSpeed !== 0)
            vec3.scaleAndAdd(particle.velocity, particle.velocity, awayFromCenter, this.awayFromCenterSpeed);
        if (this.awayFromYAxisSpeed !== 0)
            vec3.scaleAndAdd(particle.velocity, particle.velocity, awayFromYAxis, this.awayFromYAxisSpeed);
        if (this.directionalSpeed !== 0) {
            mat4.identity(scratchMatrix);
            if (this.directionalSpread !== 0) {
                const randX = get_rndm_f(this.random) * this.directionalSpread;
                const randY = get_rndm_f(this.random) * MathConstants.TAU;
                mat4.rotateY(scratchMatrix, scratchMatrix, randY);
                mat4.rotateX(scratchMatrix, scratchMatrix, randX);
            }
            mat4.rotateZ(scratchMatrix, scratchMatrix, this.emitterDir[2]);
            mat4.rotateY(scratchMatrix, scratchMatrix, this.emitterDir[1]);
            mat4.rotateX(scratchMatrix, scratchMatrix, this.emitterDir[0]);
            particle.velocity[0] += this.directionalSpeed * scratchMatrix[4];
            particle.velocity[1] += this.directionalSpeed * scratchMatrix[5];
            particle.velocity[2] += this.directionalSpeed * scratchMatrix[6];
        }
        if (this.randomDirectionSpeed !== 0) {
            const randX = get_rndm_f(this.random) * MathConstants.TAU;
            const randY = get_rndm_f(this.random) * MathConstants.TAU;
            const randZ = get_rndm_f(this.random) * MathConstants.TAU;

            const sx = Math.sin(randX), cx = Math.cos(randX);
            const sy = Math.sin(randY), cy = Math.cos(randY);
            const sz = Math.sin(randZ), cz = Math.cos(randZ);
            particle.velocity[0] += this.randomDirectionSpeed * (cx * sy * cz + sx * sz);
            particle.velocity[1] += this.randomDirectionSpeed * (cx * sy * sz - sx * cz);
            particle.velocity[2] += this.randomDirectionSpeed * (cx * cy);
        }
        if (this.normalDirectionSpeed !== 0)
            vec3.scaleAndAdd(particle.velocity, particle.velocity, normalDir, this.normalDirectionSpeed);

        if (this.initialVelRatio !== 0) {
            const velRatio = 1.0 - (this.initialVelRatio * 0.01 * get_r_zp(this.random));
            vec3.scale(particle.velocity, particle.velocity, velRatio);
        }
    }

    private calcVolumeCircle(particle: EfParticle): void {
        let [sizeX, sizeInner, angleMin, angleMax, sizeZ] = this.volumeParams;
        const emitFlags = this.resData.emitterSettings.emitFlags;

        if (!!(emitFlags & EmitFlags.Disc_SameSize))
            sizeZ = sizeX;
    }

    private calcVolumePoint(particle: EfParticle): void {
        vec3.zero(particle.position);

        const rotX = get_r_zp(this.random);
        scratchVec3a[0] = 0.66 + (Math.sign(rotX) * 0.34 * rotX) * rotX;

        const r = Math.sqrt(1 - rotX * rotX);
        const rotYZ = get_rndm_f(this.random) * MathConstants.TAU;
        scratchVec3a[1] = Math.cos(rotYZ) * r;
        scratchVec3a[2] = Math.sin(rotYZ) * r;

        vec3.copy(scratchVec3b, scratchVec3a);
        scratchVec3b[1] = 0.0;

        this.calcVelocity(particle, scratchVec3a, scratchVec3a, scratchVec3b);
    }

    private calcVolume(particle: EfParticle): void {
        const volumeType = this.resData.emitterSettings.volumeType;

        if (volumeType === VolumeType.Circle)
            this.calcVolumeCircle(particle);
        else if (volumeType === VolumeType.Point)
            this.calcVolumePoint(particle);
        else
            throw "whoops";
    }

    private createParticle(): EfParticle | null {
        if (this.effectManager.deadParticlePool.length === 0)
            return null;

        const particle = this.effectManager.deadParticlePool.pop()!;
        this.aliveParticles.push(particle);
        this.calcVolume(particle);
        particle.init(this.effectManager, this);
        return particle;
    }

    private emit(deltaTime: number): void {
        const emitterSettings = this.resData.emitterSettings;

        if (this.rateStepTimer > 0.0) {
            this.rateStepTimer -= deltaTime;
        } else {
            this.rateStepTimer = emitterSettings.rateStep;
            if (emitterSettings.rateStepRndm !== 0.0)
                this.rateStepTimer += Math.ceil((emitterSettings.rateStep + emitterSettings.rateStepRndm - 1.0) * this.random.randFloat());

            if (!!(emitterSettings.emitFlags & EmitFlags.FixedInterval)) {
                // Fixed Interval
                this.emitCount = emitterSettings.divNumber;
            } else {
                // Rate
                const emitCountIncr = this.rate * (1.0 + emitterSettings.rateRndm * get_r_zp(this.random));
                this.emitCount += emitCountIncr;

                // If this is the first emission and we got extremely bad luck, force a particle.
                if (!!(this.status & EfEmitterStatus.FirstEmission) && this.rate !== 0.0 && this.emitCount < 1.0)
                    this.emitCount = 1;
            }
        }

        while (this.emitCount >= 1) {
            this.createParticle();
            this.emitCount--;
        }
    }

    public calcEmission(deltaTime: number): void {
        if (!this.processTillStartFrame(deltaTime))
            return;

        this.age += deltaTime;

        if (!(this.status & EfEmitterStatus.SpawnParticles) || !(this.status & EfEmitterStatus.Alive))
            return;

        this.emit(deltaTime);
    }

    public destroy(): void {
        // Destroy particles?
    }
}

export class EfEffect {
    public aliveEmitters: EfEmitter[] = [];

    constructor(private effectManager: EfEffectManager) {
    }

    public init(ef: EfEffectResourceData): void {
        assert(this.aliveEmitters.length === 0);
        this.createEmitter(ef);
    }

    private createEmitter(res: EfEffectResourceData): EfEmitter | null {
        if (this.effectManager.deadEmitterPool.length === 0)
            return null;

        const emitter = this.effectManager.deadEmitterPool.pop()!;
        this.aliveEmitters.push(emitter);
        emitter.init(this, res);
        return emitter;
    }

    public calc(deltaTime: number): void {
        for (let i = 0; i < this.aliveEmitters.length; i++) {
            const emitter = this.aliveEmitters[i];
            emitter.calcEmitter();
            emitter.calcParticle(deltaTime);
            emitter.calcEmission(deltaTime);

            if (!(emitter.status & EfEmitterStatus.Alive)) {
                this.aliveEmitters.splice(i, 1);
                i--;
            }
        }
    }
}

export class EfEffectManager {
    public deadParticlePool: EfParticle[] = [];
    public deadEmitterPool: EfEmitter[] = [];
    public deadEffectPool: EfEffect[] = [];
    public aliveEffects: EfEffect[] = [];
    public random = new EfRandom();

    constructor(private maxEffectCount: number, private maxEmitterCount: number, private maxParticleCount: number) {
        for (let i = 0; i < this.maxEmitterCount; i++)
            this.deadEffectPool.push(new EfEffect(this));
        for (let i = 0; i < this.maxEmitterCount; i++)
            this.deadEmitterPool.push(new EfEmitter(this));
        for (let i = 0; i < this.maxParticleCount; i++)
            this.deadParticlePool.push(new EfParticle());
    }

    public createEffect(resData: EfEffectResourceData): EfEffect | null {
        if (this.deadEffectPool.length === 0)
            return null;

        const effect = assertExists(this.deadEffectPool.pop());
        effect.init(resData);
        this.aliveEffects.push(effect);
        return effect;
    }

    public destroyEmitter(em: EfEmitter): void {
        em.destroy();
        this.deadEmitterPool.push(em);
    }

    public destroyParticle(p: EfParticle): void {
        this.deadParticlePool.push(p);
    }

    public calc(deltaTime: number): void {
        // Clamp deltaTime to something reasonable so we don't get a combinatorial
        // explosion of particles at scene load...
        deltaTime = Math.min(deltaTime, 1.5);

        if (deltaTime === 0)
            return;

        for (let i = 0; i < this.aliveEffects.length; i++) {
            const effect = this.aliveEffects[i];
            effect.calc(deltaTime);
        }
    }
}

export interface EfEffectResourceData {
    name: string;
    emitterSettings: EmitterSettings;
    materialSettings: MaterialSettings;
    particleSettings: ParticleSettings;
    emitterTrackInfos: TrackInfo[];
    particleTrackInfos: TrackInfo[];
}

function parseEffectResource(buffer: ArrayBufferSlice, name: string): EfEffectResourceData {
    const view = buffer.createDataView();

    let offs = 0x04;

    const emitterSettingsSize = view.getUint32(offs + 0x00);
    offs += 0x04;
    const emitterSettings = parseEmitterSettings(buffer.subarray(offs + 0x00));
    offs += 0x94;

    // Material settings seem to be part of emitter settings?
    const materialSettings = parseMaterialSettings(buffer.subarray(offs + 0x00));
    offs += 0xBC;

    // TODO(jstpierre): What's going on here?
    offs -= 0x04;

    const particleSettingsSize = view.getUint32(offs + 0x00);
    offs += 0x04;
    const particleSettings = parseParticleSettings(buffer.subarray(offs + 0x00));
    offs += particleSettingsSize;

    const particleTrackTableCount = view.getUint16(offs + 0x00);
    offs += 0x04;
    offs += particleTrackTableCount * 0x04;

    const particleTrackSizeTableOffs = offs;
    offs += particleTrackTableCount * 0x04;

    const emitterTrackTableCount = view.getUint16(offs + 0x00);
    offs += 0x04;
    offs += emitterTrackTableCount * 0x04;

    const emitterTrackSizeTableOffs = offs;
    offs += emitterTrackTableCount * 0x04;

    const particleTrackInfos: TrackInfo[] = [];
    for (let i = 0; i < particleTrackTableCount; i++) {
        const particleTrackSize = view.getUint32(particleTrackSizeTableOffs + i * 0x04);
        const particleTrackInfo = parseTrackInfo(buffer.subarray(offs, particleTrackSize));
        particleTrackInfos.push(particleTrackInfo);
        offs += particleTrackSize;
    }

    const emitterTrackInfos: TrackInfo[] = [];
    for (let i = 0; i < emitterTrackTableCount; i++) {
        const emitterTrackSize = view.getUint32(emitterTrackSizeTableOffs + i * 0x04);
        const emitterTrackInfo = parseTrackInfo(buffer.subarray(offs, emitterTrackSize));
        emitterTrackInfos.push(emitterTrackInfo);
        offs += emitterTrackSize;
    }

    assert(offs === buffer.byteLength);
    return { name, emitterSettings, materialSettings, particleSettings, emitterTrackInfos, particleTrackInfos };
}

const enum VolumeType {
    Circle   = 0x00,
    Line     = 0x01,
    Cube     = 0x05,
    Cylinder = 0x07,
    Sphere   = 0x08,
    Point    = 0x09,
    Torus    = 0x0A,
}

const enum EmitterSimFlags {
    Forever = 1 << 2,
}

const enum EmitFlags {
    FixedInterval     = 0x00000200,
    FixedPosition     = 0x00000400,

    Disc_FixedDensity = 0x00010000,
    Disc_SameSize     = 0x00020000,
}

interface EmitterSettings {
    emitterSimFlags: EmitterSimFlags;
    volumeType: VolumeType;
    emitFlags: EmitFlags;

    startFrame: number;
    prerollTime: number;
    maxFrame: number;

    rate: number;
    rateRndm: number;
    rateStep: number;
    rateStepRndm: number;
    divNumber: number;
    lifeTime: number;
    lifeTimeRndm: number;
    volumeParams: number[];

    emitterScl: ReadonlyVec3;
    emitterTrs: ReadonlyVec3;
    emitterRot: ReadonlyVec3;
    emitterDir: ReadonlyVec3;

    initialVelRatio: number;
    initialVelOmni: number;
    initialVelAxis: number;
    initialVelNrm: number;
    initialVelRndm: number;
    initialVelDir: number;
    diffuseVelDir: number;
    momentRndm: number;

    randomSeed: number;
}

function parseEmitterSettings(buffer: ArrayBufferSlice): EmitterSettings {
    const view = buffer.createDataView();

    const emitterSimFlags: EmitterSimFlags = view.getUint32(0x00);
    const volumeTypeAndEmitFlags = view.getUint32(0x04);

    const volumeType: VolumeType = volumeTypeAndEmitFlags & 0xFF;
    const emitFlags: EmitFlags = (volumeTypeAndEmitFlags >>> 8);

    const maxFrame = view.getUint16(0x08);
    const lifeTime = view.getUint16(0x0A);
    const lifeTimeRndm = view.getInt8(0x0C) / 100.0;
    const particleChildInheritTranslation = view.getInt8(0x0D);

    const rateStepRndm = view.getInt8(0x0E) / 100.0;
    const rateRndm = view.getInt8(0x0F);
    const rate = view.getFloat32(0x10);
    const startFrame = view.getUint16(0x14);
    const prerollTime = view.getUint16(0x16);
    const rateStep = view.getUint16(0x18);
    const particleInheritTranslation = view.getInt8(0x1A);
    const emitterChildInheritTranslation = view.getInt8(0x1B);

    const volumeParams = nArray(6, (i) => view.getFloat32(0x1C + 0x04 * i));
    const divNumber = view.getUint16(0x34);
    const initialVelRatio = view.getInt8(0x36);
    const momentRndm = view.getInt8(0x37) / 100.0;
    const initialVelOmni = view.getFloat32(0x38);
    const initialVelAxis = view.getFloat32(0x3C);
    const initialVelRndm = view.getFloat32(0x40);
    const initialVelNrm = view.getFloat32(0x44);
    const diffuseVelNrm = view.getFloat32(0x48);

    const initialVelDir = view.getFloat32(0x4C);
    const diffuseVelDir = view.getFloat32(0x50);
    const emitterDirX = view.getFloat32(0x54);
    const emitterDirY = view.getFloat32(0x58);
    const emitterDirZ = view.getFloat32(0x5C);
    const emitterDir = vec3.fromValues(emitterDirX, emitterDirY, emitterDirZ);

    const emitterSclX = view.getFloat32(0x60);
    const emitterSclY = view.getFloat32(0x64);
    const emitterSclZ = view.getFloat32(0x68);
    const emitterScl = vec3.fromValues(emitterSclX, emitterSclY, emitterSclZ);

    const emitterRotX = view.getFloat32(0x6C);
    const emitterRotY = view.getFloat32(0x70);
    const emitterRotZ = view.getFloat32(0x74);
    const emitterRot = vec3.fromValues(emitterRotX, emitterRotY, emitterRotZ);

    const emitterTrsX = view.getFloat32(0x78);
    const emitterTrsY = view.getFloat32(0x7C);
    const emitterTrsZ = view.getFloat32(0x80);
    const emitterTrs = vec3.fromValues(emitterTrsX, emitterTrsY, emitterTrsZ);

    const lodNear = view.getUint8(0x84);
    const lodFar = view.getUint8(0x85);
    const lodMinEmit = view.getUint8(0x86);
    const lodAlpha = view.getUint8(0x87);

    const randomSeed = view.getUint32(0x88);

    return {
        emitterSimFlags, volumeType, emitFlags,
        maxFrame,
        startFrame, prerollTime,
        rate, rateRndm, rateStep, rateStepRndm, divNumber, lifeTime, lifeTimeRndm,
        initialVelRatio, initialVelOmni, initialVelAxis, initialVelDir, initialVelNrm, initialVelRndm, diffuseVelDir,
        momentRndm,
        emitterScl, emitterRot, emitterTrs, emitterDir,
        volumeParams, randomSeed,
    };
}

const enum ShapeType {
    Point, Line, Free, Billboard, Directional, Stripe,
}

const enum RotType {
    X, Y, Z, XYZ,
}

const enum MaterialLightType {
    None, Ambient, Point,
}

interface MaterialLight {
    mode: number;
    type: MaterialLightType;
    amb: Color;
    dif: Color;
    radius: number;
    pos: ReadonlyVec3;
}

interface MaterialSettings {
    material: GXMaterial;

    light: MaterialLight;
    indTexMtx: ReadonlyMat4;

    shapeType: ShapeType;
    shapeOption: number;
    shapeDir: number;
    shapeAxis: RotType;
    shapeFlags: number;

    pivotX: number;
    pivotY: number;
}

function parseMaterialSettings(buffer: ArrayBufferSlice): MaterialSettings {
    const view = buffer.createDataView();
    const mb = new GXMaterialBuilder();

    const flags = view.getUint16(0x00);

    const alphaCmp0 = view.getUint8(0x02);
    const alphaCmp1 = view.getUint8(0x03);
    const alphaOp = view.getUint8(0x04);

    // Alpha ref is part of particle settings for some reason.
    mb.setAlphaCompare(alphaCmp0, 0, alphaOp, alphaCmp1, 0);

    for (let i = 0; i < 3; i++) {
        const useTexture = !!((flags >>> (4 + i)) & 0x01);
        if (!useTexture)
            continue;

        const useTexProj = !!((flags >>> (7 + i)) & 0x01);
        if (useTexProj) {
            mb.setTexCoordGen(i, GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.PNMTX0, false, GX.PostTexGenMatrix.PTTEXMTX0 + i * 3);
        } else {
            mb.setTexCoordGen(i, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX0 + i * 3);
        }
    }

    const tevStageCount = view.getUint8(0x05);
    // 0x06 = unk
    const indStageFlags = view.getUint8(0x07);

    for (let i = 0; i < tevStageCount; i++) {
        const whichTexture = view.getUint8(0x08 + i * 0x01);
        if (whichTexture < 2)
            mb.setTevOrder(i, GX.TexCoordID.TEXCOORD0 + whichTexture, GX.TexMapID.TEXMAP0 + whichTexture, GX.RasColorChannelID.COLOR0A0);
        else
            mb.setTevOrder(i, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR_ZERO);

        const colorInA = view.getUint8(0x08 + 0x04 + i * 0x04 + 0x00);
        const colorInB = view.getUint8(0x08 + 0x04 + i * 0x04 + 0x01);
        const colorInC = view.getUint8(0x08 + 0x04 + i * 0x04 + 0x02);
        const colorInD = view.getUint8(0x08 + 0x04 + i * 0x04 + 0x03);
        mb.setTevColorIn(i, colorInA, colorInB, colorInC, colorInD);

        const colorOp       = view.getUint8(0x08 + 0x14 + i * 0x05 + 0x00);
        const colorBias     = view.getUint8(0x08 + 0x14 + i * 0x05 + 0x01);
        const colorScale    = view.getUint8(0x08 + 0x14 + i * 0x05 + 0x02);
        const colorClamp = !!(view.getUint8(0x08 + 0x14 + i * 0x05 + 0x03));
        const colorRegId    = view.getUint8(0x08 + 0x14 + i * 0x05 + 0x04);
        mb.setTevColorOp(i, colorOp, colorBias, colorScale, colorClamp, colorRegId);

        const alphaInA = view.getUint8(0x08 + 0x28 + i * 0x04 + 0x00);
        const alphaInB = view.getUint8(0x08 + 0x28 + i * 0x04 + 0x01);
        const alphaInC = view.getUint8(0x08 + 0x28 + i * 0x04 + 0x02);
        const alphaInD = view.getUint8(0x08 + 0x28 + i * 0x04 + 0x03);
        mb.setTevAlphaIn(i, alphaInA, alphaInB, alphaInC, alphaInD);

        const alphaOp       = view.getUint8(0x08 + 0x38 + i * 0x05 + 0x00);
        const alphaBias     = view.getUint8(0x08 + 0x38 + i * 0x05 + 0x01);
        const alphaScale    = view.getUint8(0x08 + 0x38 + i * 0x05 + 0x02);
        const alphaClamp = !!(view.getUint8(0x08 + 0x38 + i * 0x05 + 0x03));
        const alphaRegId    = view.getUint8(0x08 + 0x38 + i * 0x05 + 0x04);
        mb.setTevAlphaOp(i, alphaOp, alphaBias, alphaScale, alphaClamp, alphaRegId);

        const colorSel = view.getUint8(0x08 + 0x4C + i * 0x01);
        mb.setTevKColorSel(i, colorSel);

        const alphaSel = view.getUint8(0x08 + 0x50 + i * 0x01);
        mb.setTevKColorSel(i, alphaSel);
    }

    const blendMode = view.getUint8(0x5C);
    const blendSrc  = view.getUint8(0x5D);
    const blendDst  = view.getUint8(0x5E);
    const blendOp   = view.getUint8(0x5F);
    mb.setBlendMode(blendMode, blendSrc, blendDst, blendOp);

    const colorRas = view.getUint8(0x60);
    const colorTev0 = view.getUint8(0x61);
    const colorTev1 = view.getUint8(0x62);
    const colorTev2 = view.getUint8(0x63);
    const colorKTev0 = view.getUint8(0x64);
    const colorKTev1 = view.getUint8(0x65);
    const colorKTev2 = view.getUint8(0x66);
    const colorKTev3 = view.getUint8(0x67);

    const alphaRas = view.getUint8(0x68);
    const alphaTev0 = view.getUint8(0x69);
    const alphaTev1 = view.getUint8(0x6A);
    const alphaTev2 = view.getUint8(0x6B);
    const alphaKTev0 = view.getUint8(0x6C);
    const alphaKTev1 = view.getUint8(0x6D);
    const alphaKTev2 = view.getUint8(0x6E);
    const alphaKTev3 = view.getUint8(0x6F);

    const depthTest = !!(flags & 0x01);
    const depthWrite = !!(flags & 0x02);
    const depthFunc = view.getUint8(0x70);
    mb.setZMode(depthTest, depthFunc, depthWrite);

    const alphaFlickType = view.getUint8(0x71);
    const alphaFlickPhase = view.getUint16(0x72);
    const alphaFlickRndm = view.getUint8(0x74);
    const alphaFlickStrength = view.getUint8(0x75);

    const lightMode = view.getUint8(0x78);
    const lightType = view.getUint8(0x79);
    const lightAmb = colorNewFromRGBA8(view.getUint32(0x7C));
    const lightDif = colorNewFromRGBA8(view.getUint32(0x80));
    const lightRadius = view.getFloat32(0x84);
    const lightPosX = view.getFloat32(0x88);
    const lightPosY = view.getFloat32(0x8C);
    const lightPosZ = view.getFloat32(0x90);

    const light: MaterialLight = {
        mode: lightMode,
        type: lightType,
        amb: lightAmb,
        dif: lightDif,
        radius: lightRadius,
        pos: vec3.fromValues(lightPosX, lightPosY, lightPosZ),
    };

    const indTexMtx00 = view.getFloat32(0x94);
    const indTexMtx01 = view.getFloat32(0x98);
    const indTexMtx02 = view.getFloat32(0x9C);
    const indTexMtx10 = view.getFloat32(0xA0);
    const indTexMtx11 = view.getFloat32(0xA4);
    const indTexMtx12 = view.getFloat32(0xA8);
    const indTexMtxScale = Math.pow(2, view.getInt8(0xAC));
    const indTexMtx = new Float32Array([
        indTexMtx00*indTexMtxScale, indTexMtx01*indTexMtxScale, indTexMtx02*indTexMtxScale, indTexMtxScale,
        indTexMtx10*indTexMtxScale, indTexMtx11*indTexMtxScale, indTexMtx12*indTexMtxScale, 0.0,
    ]);
    const pivotX = view.getInt8(0xAD);
    const pivotY = view.getInt8(0xAE);

    const shapeType = view.getUint8(0xB0);
    const shapeOption = view.getUint8(0xB1);
    const shapeDir = view.getUint8(0xB2);
    const shapeAxis = view.getUint8(0xB3);
    const shapeFlags = view.getUint32(0xB4);
    const shapeZOffset = view.getFloat32(0xB8);

    const material = mb.finish();

    return { material,
        light, indTexMtx,
        shapeType, shapeOption, shapeDir, shapeAxis, shapeFlags,
        pivotX, pivotY,
    };
}

interface ParticleSettings {
}

function parseParticleSettings(buffer: ArrayBufferSlice): ParticleSettings {
    const view = buffer.createDataView();

    const colors: Color[] = [
        colorNewFromRGBA8(view.getUint32(0x00)),
        colorNewFromRGBA8(view.getUint32(0x04)),
        colorNewFromRGBA8(view.getUint32(0x08)),
        colorNewFromRGBA8(view.getUint32(0x0C)),
    ];
    const sizeX = view.getFloat32(0x10);
    const sizeY = view.getFloat32(0x14);
    const scaleX = view.getFloat32(0x18);
    const scaleY = view.getFloat32(0x1C);
    const rotationX = view.getFloat32(0x20);
    const rotationY = view.getFloat32(0x24);
    const rotationZ = view.getFloat32(0x28);

    const texScale0S = view.getFloat32(0x2C);
    const texScale0T = view.getFloat32(0x30);
    const texScale1S = view.getFloat32(0x34);
    const texScale1T = view.getFloat32(0x38);
    const texScale2S = view.getFloat32(0x3C);
    const texScale2T = view.getFloat32(0x40);

    const texRotation0 = view.getFloat32(0x44);
    const texRotation1 = view.getFloat32(0x48);
    const texRotation2 = view.getFloat32(0x4C);

    const texTranslation0S = view.getFloat32(0x50);
    const texTranslation0T = view.getFloat32(0x54);
    const texTranslation1S = view.getFloat32(0x58);
    const texTranslation1T = view.getFloat32(0x5C);
    const texTranslation2S = view.getFloat32(0x60);
    const texTranslation2T = view.getFloat32(0x64);

    const textureWrapMode = view.getUint16(0x74);
    const textureMirror = view.getUint8(0x76);

    const alphaRef0 = view.getUint8(0x77);
    const alphaRef1 = view.getUint8(0x78);

    const rotationRandom0 = view.getUint8(0x79);
    const rotationRandom1 = view.getUint8(0x7A);
    const rotationRandom2 = view.getUint8(0x7B);
    const rotation0 = view.getFloat32(0x7C);
    const rotation1 = view.getFloat32(0x80);
    const rotation2 = view.getFloat32(0x84);

    let offs = 0x88;
    const textureNames: string[] = [];
    for (let i = 0; i < 3; i++) {
        const textureNameLen = view.getUint16(offs + 0x00);
        offs += 0x02;
        textureNames[i] = readString(buffer, offs + 0x00, textureNameLen);
        offs += textureNameLen;
    }

    return { };
}

interface TrackInfoU8 {
}

type TrackInfo = TrackInfoU8;

const enum TrackDataType {
    U8 = 0,
    POSTFIELD = 2,
    F32 = 3,
    TEXTURE = 4,
    CHILD = 5,
    ROTATE = 6,
    FIELD = 7,
    EMITTER_F32 = 11,
}

function parseTrackInfo(buffer: ArrayBufferSlice): TrackInfo {
    const view = buffer.createDataView();

    const magic = view.getUint8(0x00);
    assert(magic === 0xAC);

    const target = view.getUint8(0x01);
    const dataType: TrackDataType = view.getUint8(0x02);

    return { };
}

export interface BREFF {
    name: string;
    effects: EfEffectResourceData[];
}

export function parseBREFF(buffer: ArrayBufferSlice): BREFF {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'REFF');
    const littleEndianMarker = view.getUint16(0x04);
    assert(littleEndianMarker === 0xFEFF || littleEndianMarker === 0xFFFE);
    const littleEndian = (littleEndianMarker === 0xFFFE);
    assert(!littleEndian);
    const fileVersion = view.getUint16(0x06);
    const fileLength = view.getUint32(0x08);
    const rootSectionOffs = view.getUint16(0x0C);
    const numSections = view.getUint16(0x0E);

    const effectTableOffs = rootSectionOffs + 0x08 + view.getUint32(rootSectionOffs + 0x08);
    const nameLen = view.getUint16(rootSectionOffs + 0x14);
    const name = readString(buffer, rootSectionOffs + 0x18, nameLen);

    const effectTableCount = view.getUint16(effectTableOffs + 0x04);
    const effects: EfEffectResourceData[] = [];
    for (let i = 0, effectTableIdx = effectTableOffs + 0x08; i < effectTableCount; i++) {
        const effectNameLen = view.getUint16(effectTableIdx + 0x00);
        effectTableIdx += 0x02;

        const effectName = readString(buffer, effectTableIdx + 0x00, effectNameLen);
        effectTableIdx += effectNameLen;

        const effectDataOffs = effectTableOffs + view.getUint32(effectTableIdx + 0x00);
        const effectDataSize = view.getUint32(effectTableIdx + 0x04);
        effectTableIdx += 0x08;

        effects.push(parseEffectResource(buffer.subarray(effectDataOffs, effectDataSize), effectName));
    }

    return { name, effects };
}

interface BREFTTexture {
    name: string;
    format: GX.TexFormat;
    width: number;
    height: number;
    data: ArrayBufferSlice | null;
    mipCount: number;
    paletteFormat: GX.TexPalette | null;
    paletteData: ArrayBufferSlice | null;
}

export interface BREFT {
    name: string;
    textures: BREFTTexture[];
}

export function parseBREFT(buffer: ArrayBufferSlice): BREFT {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'REFT');
    const littleEndianMarker = view.getUint16(0x04);
    assert(littleEndianMarker === 0xFEFF || littleEndianMarker === 0xFFFE);
    const littleEndian = (littleEndianMarker === 0xFFFE);
    assert(!littleEndian);
    const fileVersion = view.getUint16(0x06);
    const fileLength = view.getUint32(0x08);
    const rootSectionOffs = view.getUint16(0x0C);
    const numSections = view.getUint16(0x0E);

    const textureTableOffs = rootSectionOffs + 0x08 + view.getUint32(rootSectionOffs + 0x08);
    const nameLen = view.getUint16(rootSectionOffs + 0x14);
    const name = readString(buffer, rootSectionOffs + 0x18, nameLen);

    const textureTableCount = view.getUint16(textureTableOffs + 0x04);
    const textures: BREFTTexture[] = [];
    for (let i = 0, textureTableIdx = textureTableOffs + 0x08; i < textureTableCount; i++) {
        const textureNameLen = view.getUint16(textureTableIdx + 0x00);
        textureTableIdx += 0x02;

        const textureName = readString(buffer, textureTableIdx + 0x00, textureNameLen);
        textureTableIdx += textureNameLen;

        const textureDataOffs = view.getUint32(textureTableOffs + 0x00);
        const textureDataSize = view.getUint32(textureTableOffs + 0x04);
        textureTableIdx += 0x08;

        const width = view.getUint16(textureDataOffs + 0x04);
        const height = view.getUint16(textureDataOffs + 0x06);
        const dataSize = view.getUint32(textureDataOffs + 0x08);
        const format = view.getUint8(textureDataOffs + 0x0C);
        const paletteFormat = view.getUint8(textureDataOffs + 0x0D);
        const paletteEntries = view.getUint16(textureDataOffs + 0x0E);
        const paletteSize = view.getUint32(textureDataOffs + 0x10);
        const mipmap = view.getUint8(textureDataOffs + 0x14);

        const mipCount = mipmap ? 999 : 1;
        const data = buffer.subarray(textureDataOffs + 0x20, dataSize);
        const paletteData = paletteSize !== 0 ? buffer.subarray(textureDataOffs + 0x20 + dataSize, paletteSize) : null;

        textures.push({ name: textureName, format, width, height, mipCount, data, paletteData, paletteFormat });
    }

    return { name, textures };
}
