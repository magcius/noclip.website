import { mat4, vec4, vec3, vec2 } from "gl-matrix";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { ViewerRenderInput } from "../viewer";
import { FlipbookRenderer, MovementController, FlipbookData } from "./render";
import { nArray } from "../util";
import { MathConstants, lerp } from "../MathHelpers";
import { FlipbookMode } from "./flipbook";

export const enum ParticleType {
    Sparkle,
    AirBubble, // actually an object in the game
    Configurable, // from a separate particle system
}

const enum MotionType {
    Static,
    ConstantVelocity,
    Projectile,
    StopOnCollision,
    BounceOnCollision,
}

const sparkleOffset = 0x10;

const particleScratch = vec3.create();
export class Particle {
    public timer = -1;
    public lifetime = 0; // initial timer value
    public parent: Emitter | null = null;

    public modelMatrix = mat4.create();
    public velocity = vec3.create();
    public targetVelocity = vec3.create();
    public accel = vec3.create();
    public maxAccel = 0;
    public sinceUpdate = 0;

    public type: ParticleType;
    public relativeScale = false;
    public startScale = 0;
    public endScale = 0;
    public scaleX = 0;
    public scaleY = 0;
    public rotationSpeed = 0;
    public motionType = MotionType.Static;
    public flipbook: FlipbookRenderer;

    constructor(dummyFlipbookData: FlipbookData) {
        this.flipbook = new FlipbookRenderer(dummyFlipbookData);
    }

    // maybe turn this into a piecewise linear function?
    private static sparkleDimensions = [10, 10, 15, 20, 25, 30, 35, 40, 45, 50, 54, 58, 62, 66, 70, 74, 76, 78, 80, 40, 20];

    public init(manager: EmitterManager, type: ParticleType, matrix: mat4, flipbookIndex = 0): void {
        this.type = type;
        mat4.copy(this.modelMatrix, matrix);
        vec3.set(this.velocity, 0, 0, 0);
        vec3.set(this.targetVelocity, 0, 0, 0);
        vec3.set(this.accel, 0, 0, 0);

        this.scaleX = 0;
        this.scaleY = 0;
        this.flipbook.rotationAngle = 0;
        this.rotationSpeed = 0;
        vec4.set(this.flipbook.primColor, 1, 1, 1, 1);
        vec2.set(this.flipbook.screenOffset, 0, 0);
        this.relativeScale = false;

        switch (this.type) {
            case ParticleType.Sparkle:
                this.timer = 20 / 30; // lifetime is 20 frames
                this.motionType = MotionType.Static;
                this.rotationSpeed = 7 * MathConstants.DEG_TO_RAD * 30;
                vec4.set(this.flipbook.primColor, 1, 1, 1, 180 / 255);
                this.flipbook.changeData(manager.getFlipbook(sparkleOffset + flipbookIndex), FlipbookMode.Translucent);
                break;
            case ParticleType.AirBubble:
                this.timer = 10;
                this.motionType = MotionType.ConstantVelocity;
                this.endScale = 200;
                vec3.set(this.targetVelocity, 0, 80, 0)
                vec4.set(this.flipbook.primColor, 180 / 255, 240 / 255, 160 / 255, 160 / 255);
                this.flipbook.changeData(manager.getFlipbook(4), FlipbookMode.Opaque, true);
                this.sinceUpdate = 1;
                break;
            case ParticleType.Configurable:
                this.relativeScale = true;
                this.motionType = MotionType.Projectile;
                (this.parent as ConfigurableEmitter).initParticle(manager, this);
                this.timer = this.lifetime;
        }
    }

    private motion(deltaSeconds: number): void {
        if (this.motionType === MotionType.Static)
            return;

        mat4.getTranslation(particleScratch, this.modelMatrix)
        if (this.motionType !== MotionType.ConstantVelocity) {
            vec3.scaleAndAdd(this.velocity, this.velocity, this.accel, deltaSeconds);
            if (this.maxAccel > 0)
                this.velocity[1] = Math.max(this.velocity[1], this.maxAccel * deltaSeconds);
        }

        vec3.scaleAndAdd(particleScratch, particleScratch, this.velocity, deltaSeconds);
        this.modelMatrix[12] = particleScratch[0];
        this.modelMatrix[13] = particleScratch[1];
        this.modelMatrix[14] = particleScratch[2];
    }

    public update(deltaSeconds: number): boolean {
        switch (this.type) {
            case ParticleType.Sparkle:
                this.scaleX = Particle.sparkleDimensions[(this.timer * 30) >>> 0];
                this.scaleY = this.scaleX;
                break;
            case ParticleType.AirBubble:
                const commonStep = deltaSeconds * 230
                this.scaleX = Math.min(this.endScale, this.scaleX + commonStep);
                this.scaleY = this.scaleX;
                vec2.set(this.flipbook.screenOffset, -this.scaleX / 2, this.scaleY / 2);
                for (let i = 0; i < 3; i++) {
                    if (this.velocity[i] < this.targetVelocity[i])
                        this.velocity[i] = Math.min(this.velocity[i] + 10 * commonStep, this.targetVelocity[i]);
                    else
                        this.velocity[i] = Math.max(this.velocity[i] - 10 * commonStep, this.targetVelocity[i]);
                }
                // game has some logic to update at random intervals,
                // but the constants are such that it always updates every other frame
                this.sinceUpdate += deltaSeconds;
                if (this.sinceUpdate > 1 / 15) {
                    this.sinceUpdate = 0;
                    this.targetVelocity[0] = 100 * Math.random() - 50;
                    this.targetVelocity[2] = 100 * Math.random() - 50;
                }
                break;
            case ParticleType.Configurable:
                (this.parent as ConfigurableEmitter).config.updateParticle(this);
        }

        this.motion(deltaSeconds);
        mat4.copy(this.flipbook.modelMatrix, this.modelMatrix);
        if (this.relativeScale)
            vec3.set(particleScratch, this.scaleX, this.scaleY, 1);
        else {
            const baseFlipbook = this.flipbook.flipbookData.flipbook;
            vec3.set(particleScratch, this.scaleX / baseFlipbook.width, this.scaleY / baseFlipbook.height, 1);
        }
        mat4.scale(this.flipbook.modelMatrix, this.flipbook.modelMatrix, particleScratch);
        this.flipbook.rotationAngle += this.rotationSpeed * deltaSeconds;

        this.timer -= deltaSeconds;
        return this.timer >= 0;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (this.timer < 0)
            return;

        this.update(viewerInput.deltaTime / 1000);
        if (this.flipbook !== null)
            this.flipbook.prepareToRender(device, renderInstManager, viewerInput)
    }
}

export class Emitter {
    public shouldEmit = false;
    public modelMatrix = mat4.create();
    public movementController: MovementController | null = null

    constructor(private type: ParticleType, private sparkleColor = SparkleColor.Yellow) { }

    public update(manager: EmitterManager, time: number, deltaSeconds: number): boolean {
        if (this.movementController !== null)
            this.movementController.movement(this.modelMatrix, time);
        if (!this.shouldEmit)
            return false;
        this.shouldEmit = false;
        return this.emit(manager);
    }

    public emit(manager: EmitterManager): boolean {
        const newParticle = manager.getParticle();
        if (newParticle === null)
            return false;
        newParticle.parent = this;
        newParticle.init(manager, this.type, this.modelMatrix, this.sparkleColor);
        return true;
    }
}

const emitterScratch = vec3.create();
export function emitAlongLine(manager: EmitterManager, emitter: Emitter, start: vec3, end: vec3, count: number): void {
    for (let i = 0; i < count; i++) {
        vec3.lerp(emitterScratch, start, end, i / (count - 1));
        mat4.fromTranslation(emitter.modelMatrix, emitterScratch);
        if (!emitter.emit(manager))
            return;
    }
}

export const enum SparkleColor {
    Purple = 0,
    DarkBlue = 1,
    Green = 2,
    Yellow = 3,
    Orange = 4,
    Red = 5,
    LightBlue = 6,
    LightYellow = 7,
    Blue = 8, // very similar to LightBlue
    LightGreen = 9,
    Pink = 10,
    YellowOrange = 11,
}

export class Sparkler extends Emitter {
    constructor(private sparkleRate: number, sparkleColor: SparkleColor = SparkleColor.Yellow) {
        super(ParticleType.Sparkle, sparkleColor);
    }

    public update(manager: EmitterManager, time: number, deltaSeconds: number): boolean {
        // Poisson process in this time interval, assuming base rate is for a 30 fps frame
        this.shouldEmit = Math.random() > Math.exp(-this.sparkleRate * deltaSeconds * 30);
        return super.update(manager, time, deltaSeconds);
    }
}

const allOnes = vec4.fromValues(1, 1, 1, 1);
class EmitterConfig {
    public spriteIndex = 0;
    public delayRange = vec2.fromValues(0, 5);
    // not really in the game, this is to handle some emitters
    // which are created just to spawn a single particle
    // but otherwise use the same logic
    public frameChance = 0;

    public primColor = vec4.fromValues(1, 1, 1, 1);
    public offset = vec3.create();
    public pulseRange = vec2.fromValues(0, 1);
    // bounding boxes
    public accelMin = vec3.create();
    public accelMax = vec3.create();
    public velMin = vec3.create();
    public velMax = vec3.create();
    public offsetMin = vec3.create();
    public offsetMax = vec3.create();
    // random parameter ranges
    public lifetimeRange = vec2.fromValues(0, 5);
    public startScaleRange = vec2.fromValues(1, 1);
    public endScaleRange = vec2.create();
    public phaseRange = vec2.create();
    public fpsRange = vec2.create();
    public rotationRange = vec2.create();

    constructor(init?: Partial<EmitterConfig>) {
        if (init !== undefined)
            Object.assign(this, init);
    }


    public initParticle(dst: vec3, manager: EmitterManager, p: Particle): void {
        fromBB(p.accel, this.accelMin, this.accelMax);
        fromBB(p.velocity, this.velMin, this.velMax);
        fromBB(dst, this.offsetMin, this.offsetMax);

        p.lifetime = fromRange(this.lifetimeRange);
        p.startScale = fromRange(this.startScaleRange);
        if (this.endScaleRange[0] === 0 && this.endScaleRange[1] === 0)
            p.endScale = p.startScale;
        else
            p.endScale = fromRange(this.endScaleRange);
        p.rotationSpeed = fromRange(this.rotationRange) * MathConstants.DEG_TO_RAD;

        const mode = vec4.exactEquals(this.primColor, allOnes) ? FlipbookMode.Opaque : FlipbookMode.EmittedParticle;
        p.flipbook.changeData(manager.getFlipbook(this.spriteIndex), mode);
        vec4.copy(p.flipbook.primColor, this.primColor);
        p.flipbook.animationController.adjustTimeToNewFPS(fromRange(this.fpsRange));
        p.flipbook.animationController.setPhaseToCurrent();
        p.flipbook.animationController.phaseFrames += fromRange(this.phaseRange);
    }

    public updateParticle(p: Particle): void {
        const t = 1 - p.timer / p.lifetime;

        p.scaleX = lerp(p.startScale, p.endScale, t);
        p.scaleY = p.scaleX;

        // set alpha from pulse envelope
        let newAlpha = this.primColor[3];
        if (t < this.pulseRange[0])
            newAlpha *= t / this.pulseRange[0];
        else if (t > this.pulseRange[1])
            newAlpha *= 1 - (t - this.pulseRange[1]) / (1 - this.pulseRange[1]);
        p.flipbook.primColor[3] = newAlpha;

        for (let i = 0; i < 3; i++)
            p.flipbook.envColor[i] = Math.max(0, this.primColor[i] - 8 / 255);
        p.flipbook.envColor[3] = this.primColor[3];
    }
}

// values are from a mixture of config structs and code
export const quicksandConfig = new EmitterConfig({
    spriteIndex: 0xd,
    frameChance: 0.2,

    primColor: vec4.fromValues(1, 1, 155 / 255, 100 / 255),
    pulseRange: vec2.fromValues(.1, .4),

    offsetMin: vec3.fromValues(-700, 0, -700),
    offsetMax: vec3.fromValues(700, 0, 700),
    velMin: vec3.fromValues(0, 90, 0),
    velMax: vec3.fromValues(0, 90, 0),

    lifetimeRange: vec2.fromValues(2, 2.5),
    startScaleRange: vec2.fromValues(2.5, 2.8),
    endScaleRange: vec2.fromValues(4, 5),

    phaseRange: vec2.fromValues(1, 6),
});

export const torchSmokeConfig = new EmitterConfig({
    spriteIndex: 0xd,
    frameChance: 1 / 40,

    primColor: vec4.fromValues(1, 1, 1, 35 / 255),
    pulseRange: vec2.fromValues(.3, .7),

    offsetMin: vec3.fromValues(0, 110, 0),
    offsetMax: vec3.fromValues(0, 110, 0),
    velMin: vec3.fromValues(0, 40, 0),
    velMax: vec3.fromValues(0, 90, 0),

    lifetimeRange: vec2.fromValues(4, 7),
    startScaleRange: vec2.fromValues(2.6, 3.2),
    endScaleRange: vec2.fromValues(5, 6),

    phaseRange: vec2.fromValues(1, 6),
});

export const torchSparkleConfig = new EmitterConfig({
    spriteIndex: 0x13,
    frameChance: 3 / 40,

    pulseRange: vec2.fromValues(.3, .7),

    offsetMin: vec3.fromValues(0, 20, 0),
    offsetMax: vec3.fromValues(0, 20, 0),
    velMin: vec3.fromValues(-30, 120, -30),
    velMax: vec3.fromValues(60, 360, 60),
    accelMin: vec3.fromValues(0, -90, 0),
    accelMax: vec3.fromValues(0, -50, 0),

    lifetimeRange: vec2.fromValues(.9, 1.3),
    startScaleRange: vec2.fromValues(.1, .2),
    endScaleRange: vec2.fromValues(.2, .4),

    phaseRange: vec2.fromValues(1, 6),
});

export const waterfallConfig = new EmitterConfig({
    spriteIndex: 0xe,

    // the waterfall foam will eventually disappear...
    lifetimeRange: vec2.fromValues(216000, 216000),
    startScaleRange: vec2.fromValues(1.8, 2.2),

    phaseRange: vec2.fromValues(0, 4),
    fpsRange: vec2.fromValues(15, 30),
});

export const brentildaWandConfig = new EmitterConfig({
    spriteIndex: 0x13,
    delayRange: vec2.fromValues(1 / 15, 1 / 15), // every other frame

    pulseRange: vec2.fromValues(.4, .8),

    offsetMin: vec3.fromValues(-15, -15, -15),
    offsetMax: vec3.fromValues(15, 15, 15),
    accelMin: vec3.fromValues(0, -250, 0),
    accelMax: vec3.fromValues(0, -250, 0),

    lifetimeRange: vec2.fromValues(.7, .7),
    startScaleRange: vec2.fromValues(.25, .3),
    endScaleRange: vec2.fromValues(.03, .03),
    rotationRange: vec2.fromValues(200, 240),
});

function fromRange(range: vec2): number {
    return range[0] + Math.random() * (range[1] - range[0]);
}

function fromBB(dst: vec3, min: vec3, max: vec3): void {
    for (let i = 0; i < 3; i++) {
        dst[i] = min[i] + Math.random() * (max[i] - min[i]);
    }
}

const configScratch = vec3.create();
export class ConfigurableEmitter extends Emitter {
    public delayTimer = 0;

    constructor(public config: EmitterConfig) {
        super(ParticleType.Configurable, config.spriteIndex);
        this.delayTimer = fromRange(this.config.delayRange);
    }

    public initParticle(manager: EmitterManager, p: Particle): void {
        this.config.initParticle(configScratch, manager, p);
        p.modelMatrix[12] += configScratch[0];
        p.modelMatrix[13] += configScratch[1];
        p.modelMatrix[14] += configScratch[2];
    }

    public update(manager: EmitterManager, time: number, deltaSeconds: number): boolean {
        if (this.config.frameChance > 0) {
            this.shouldEmit = Math.random() > Math.exp(-this.config.frameChance * deltaSeconds * 30);
        } else if (this.delayTimer <= 0) {
            this.shouldEmit = true;
            this.delayTimer = fromRange(this.config.delayRange);
        } else
            this.delayTimer -= deltaSeconds;
        return super.update(manager, time, deltaSeconds);
    }
}

export class WaterfallEmitter extends ConfigurableEmitter {
    constructor() {
        super(waterfallConfig);
    }

    public update(manager: EmitterManager, time: number, deltaSeconds: number): boolean {
        return false;
    }
}

export class ScaledEmitter extends ConfigurableEmitter {
    constructor(public scale: number, config: EmitterConfig) {
        super(config);
    }

    public initParticle(manager: EmitterManager, p: Particle): void {
        this.config.initParticle(configScratch, manager, p);

        vec3.scale(configScratch, configScratch, this.scale);
        vec3.scale(p.velocity, p.velocity, this.scale);
        vec3.scale(p.accel, p.accel, this.scale);

        p.startScale *= this.scale;
        p.endScale *= this.scale;

        p.modelMatrix[12] += configScratch[0];
        p.modelMatrix[13] += configScratch[1];
        p.modelMatrix[14] += configScratch[2];
    }
}

export class EmitterManager {
    public emitters: Emitter[] = [];
    public particlePool: Particle[] = [];

    constructor(public maxParticles: number, private flipbooks: FlipbookData[]) {
        this.particlePool = nArray(maxParticles, () => new Particle(flipbooks[sparkleOffset]));
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput) {
        for (let i = 0; i < this.emitters.length; i++)
            this.emitters[i].update(this, viewerInput.time / 1000, viewerInput.deltaTime / 1000);
        for (let i = 0; i < this.maxParticles; i++)
            this.particlePool[i].prepareToRender(device, renderInstManager, viewerInput);
    }

    public getParticle(): Particle | null {
        for (let i = 0; i < this.maxParticles; i++) {
            if (this.particlePool[i].timer < 0)
                return this.particlePool[i];
        }
        return null;
    }

    public getFlipbook(index: number): FlipbookData {
        return this.flipbooks[index];
    }
}