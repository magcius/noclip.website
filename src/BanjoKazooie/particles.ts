import { mat4, vec4, vec3, vec2 } from "gl-matrix";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { ViewerRenderInput } from "../viewer";
import { FlipbookRenderer, MovementController, FlipbookData } from "./render";
import { nArray } from "../util";
import { MathConstants } from "../MathHelpers";
import { FlipbookMode } from "./flipbook";

export const enum ParticleType {
    Sparkle,
    AirBubble, // actually an object in the game
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
    public timer = 0; // number of 30fps frames this particle has left
    public modelMatrix = mat4.create();
    public velocity = vec3.create();
    public targetVelocity = vec3.create();
    public gravity = 0;
    public maxAccel = 0;
    public sinceUpdate = 0;

    public type: ParticleType;
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

    public init(manager: EmitterManager, type: ParticleType, matrix: mat4, particleIndex = 0): void {
        this.type = type;
        mat4.copy(this.modelMatrix, matrix);
        vec3.set(this.velocity, 0, 0, 0);
        vec3.set(this.targetVelocity, 0, 0, 0);

        this.scaleX = 0;
        this.scaleY = 0;
        this.flipbook.rotationAngle = 0;
        vec4.set(this.flipbook.primColor, 1, 1, 1, 1);
        vec2.set(this.flipbook.screenOffset, 0, 0);

        switch (this.type) {
            case ParticleType.Sparkle:
                this.timer = 20;
                this.motionType = MotionType.Static;
                this.rotationSpeed = 7 * MathConstants.DEG_TO_RAD * 30;
                vec4.set(this.flipbook.primColor, 1, 1, 1, 180 / 255);
                this.flipbook.changeData(manager.getFlipbook(sparkleOffset + particleIndex), FlipbookMode.Translucent);
                break;
            case ParticleType.AirBubble:
                this.timer = 10 * 30; // time based, rather than frame
                this.motionType = MotionType.ConstantVelocity;
                vec3.set(this.targetVelocity, 0, 80, 0)
                vec4.set(this.flipbook.primColor, 180 / 255, 240 / 255, 160 / 255, 160 / 255);
                this.flipbook.changeData(manager.getFlipbook(4), FlipbookMode.Opaque, true);
                this.sinceUpdate = 1;
        }
    }

    private motion(deltaSeconds: number): void {
        if (this.motionType === MotionType.Static)
            return;

        mat4.getTranslation(particleScratch, this.modelMatrix)
        if (this.motionType !== MotionType.ConstantVelocity)
            this.velocity[1] = Math.max(this.velocity[1] - this.gravity * deltaSeconds, this.maxAccel * deltaSeconds);

        vec3.scaleAndAdd(particleScratch, particleScratch, this.velocity, deltaSeconds);
        this.modelMatrix[12] = particleScratch[0];
        this.modelMatrix[13] = particleScratch[1];
        this.modelMatrix[14] = particleScratch[2];
    }

    public update(deltaSeconds: number): boolean {
        switch (this.type) {
            case ParticleType.Sparkle:
                this.scaleX = Particle.sparkleDimensions[this.timer >>> 0];
                this.scaleY = this.scaleX;
                this.flipbook.rotationAngle += this.rotationSpeed * deltaSeconds;
                break;
            case ParticleType.AirBubble:
                const commonStep = deltaSeconds * 230
                this.scaleX = Math.min(200, this.scaleX + commonStep);
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
        }

        this.motion(deltaSeconds);
        mat4.copy(this.flipbook.modelMatrix, this.modelMatrix);
        const baseFlipbook = this.flipbook.flipbookData.flipbook;
        vec3.set(particleScratch, this.scaleX / baseFlipbook.width, this.scaleY / baseFlipbook.height, 1);
        mat4.scale(this.flipbook.modelMatrix, this.flipbook.modelMatrix, particleScratch);

        this.timer -= 30 * deltaSeconds;
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
        const newParticle = manager.getParticle();
        if (newParticle === null)
            return false;
        newParticle.init(manager, this.type, this.modelMatrix, this.sparkleColor);
        return true;
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