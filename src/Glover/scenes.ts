
import * as Viewer from '../viewer';
import * as UI from '../ui';
import * as BYML from '../byml';

import * as F3DEX from '../BanjoKazooie/f3dex';


import * as Shadows from './shadows';
import { GloverTextureHolder } from './textures';
import { SRC_FRAMERATE, DST_FRAMERATE, SRC_FRAME_TO_MS, DST_FRAME_TO_MS, CONVERT_FRAMERATE } from './timing';


import { GenericRenderable, SceneLighting } from './render';
import { GloverActorRenderer, GloverBlurRenderer, GloverElectricityRenderer, ElectricityThicknessStyle, ElectricityRandStyle, ActorMeshNode } from './actor';
import { GloverBackdropRenderer, GloverSpriteRenderer, GloverFootprintRenderer, GloverFlipbookRenderer, GloverWeatherRenderer, WeatherParams, WeatherType } from './sprite';
import { GloverEnemy } from './enemy';

import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { TextureHolder } from '../TextureHolder';
import { mat4, vec3, vec4, quat } from 'gl-matrix';
import { SceneContext } from '../SceneBase';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { executeOnPass, makeSortKey, GfxRendererLayer, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { assert, hexzero, assertExists } from '../util';
import { DataFetcher } from '../DataFetcher';
import { MathConstants, scaleMatrix, computeMatrixWithoutScale } from '../MathHelpers';
import { Color, colorNewFromRGBA } from '../Color';

import { Yellow, colorNewCopy, Magenta, White } from "../Color";
import { drawWorldSpaceLine, drawWorldSpacePoint, drawWorldSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk";

import { CameraController } from '../Camera';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { makeAttachmentClearDescriptor, makeBackbufferDescSimple, standardFullClearRenderPassDescriptor, opaqueBlackFullClearRenderPassDescriptor, pushAntialiasingPostProcessPass } from '../gfx/helpers/RenderGraphHelpers';

import { GloverLevel, GloverObjbank, GloverTexbank } from './parsers';
import { decompress } from './fla2';
import { hashStr, radianModulo, radianLerp, subtractAngles, angularDistance, axisRotationToQuaternion, pushAlongLookatVector } from './util';
import { framesets, collectibleFlipbooks, Particle, ParticlePool, particleFlipbooks, particleParameters, spawnExitParticle, MeshSparkle } from './particles';
import { BulletPool } from './bullets';


import { KaitaiStream } from './parsers/kaitai-struct';

const pathBase = `Glover`;

const powerup_objects = [
    0x03F49393, // rblades.ndo
    0x55DC14E1, // death.ndo
    0x5EC39A4D, // frogspell.ndo
    0xC187E8C7, // sticky.ndo
    0xBEC26EFE, // hercules.ndo
    0x8EF60ED1, // fast.ndo
    0x94B8EFB2, // blades.ndo
    0x0EE2F4E2, // bowling.ndo
    0x571F7F95, // power.ndo
    0x8516AC66, // bearing.ndo
    0x87C43A84, // beach.ndo
    0, // unused
    0, // unused
    0xFA9272E0, // boomer.ndo
    0xAB3EA4DB, // vanish.ndo
];

export type ObjectDirectory = Map<number, GloverObjbank.ObjectRoot>;

export class GloverWaterVolume implements GenericRenderable {
    public visible: boolean = true;

    private rippleRenderers: GloverFootprintRenderer[] = [];
    private dropletPool: ParticlePool;

    private scratchVec3: vec3 = vec3.create();

    constructor (private device: GfxDevice, private cache: GfxRenderCache, private textures: GloverTextureHolder,
        public lft: vec3, public wdh: vec3, public surface_y: number)
    {
        lft[1] = Math.min(lft[1], surface_y - 25.0);
        wdh[1] = Math.max(wdh[1], surface_y + 25.0 - lft[1]);

        this.dropletPool = new ParticlePool(device, cache, textures, 3);
    }

    public inBbox(pt: vec3) : boolean {
        return pt[0] > this.lft[0] && pt[0] <= this.lft[0] + this.wdh[0] &&
               pt[1] > this.lft[1] && pt[1] <= this.lft[1] + this.wdh[1] &&
               pt[2] > this.lft[2] && pt[2] <= this.lft[2] + this.wdh[2];
    }

    public surfaceRipple(position: vec3, velocity: vec3) {
        let renderer: GloverFootprintRenderer | null = null;
        for (let possibleRenderer of this.rippleRenderers) {
            if (!possibleRenderer.active) {
                renderer = possibleRenderer;
                break;
            }
        }
        if (renderer === null) {
            const texID = 0x08D7863E; // ai_ripple.bmp
            renderer = new GloverFootprintRenderer(this.device, this.cache, this.textures, texID);
            this.rippleRenderers.push(renderer);
        }

        let dstScale = velocity[1]/2;
        dstScale = Math.max(Math.min(dstScale, 5), 3);
        renderer.reset(0, dstScale, 0.2,
            200/255, 0, 10/255,
            80,
            position, [0,1,0]);
    }

    public splash(position: vec3, total: number, y_offset: number) {
        const thetaDelta = Math.PI * 2 / total;
        let theta = Math.random() * 6;

        for (let i = 0; i < total; i++) {
            let velocity = this.scratchVec3;
            let rnd = Math.random() * 3;
            velocity[0] = Math.cos(-theta) * rnd;
            velocity[1] = y_offset + Math.random() * 9;
            velocity[2] = Math.sin(-theta) * rnd;
            theta = radianModulo(theta + thetaDelta);

            let particle = this.dropletPool.spawn(position, velocity);
            if ((i & 1)==1) {
                particle.scale[0] = -1;
            }
        }
    }


    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible) {
            return;
        }
        for (let renderer of this.rippleRenderers) {
            if (renderer.active) {
                renderer.prepareToRender(device, renderInstManager, viewerInput);
            }
        }
        this.dropletPool.prepareToRender(device, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        for (let renderer of this.rippleRenderers) {
            renderer.destroy(device);
        }
        this.dropletPool.destroy(device);
    }

}

class GloverVent implements GenericRenderable {

    private bullets: BulletPool | null = null;
    private particles: ParticlePool | null = null;

    private lastFrameAdvance: number = 0;

    public visible: boolean = true;

    private dutyCycles: number[] = [];
    private dutyAdvance: number = 0;
    private dutyNextIdx: number = 0;

    private active: boolean = true;

    private scratchVec3: vec3 = vec3.create();

    constructor(device: GfxDevice, cache: GfxRenderCache, textureHolder: GloverTextureHolder, objects: ObjectDirectory, sceneLights: SceneLighting, private position: vec3, private velocity: vec3, private type: number, private parent: GloverPlatform | null, waterVolumes: GloverWaterVolume[]) {
        // TODO: manual scaling for fire vent in Carnival 2

        if (type === 8) {
            this.particles = new ParticlePool(device, cache, textureHolder, 0x14, waterVolumes);
        } else {
            const bulletType = {
                0: 4,
                1: 5,
                2: 5,
                3: 17,
                4: 18,
                5: 19,
                6: 20,
                7: 21,
                9: 24,
                10: 13
            }[type];
            if (bulletType !== undefined) {
                this.bullets = new BulletPool(device, cache, textureHolder, objects, sceneLights, bulletType, waterVolumes);
                // TODO: particle pool for bullet type 24/0x18
            }
        }
    }

    public destroy(device: GfxDevice): void {
        if (this.particles !== null) {
            this.particles.destroy(device);
        }
        if (this.bullets !== null) {
            this.bullets.destroy(device);
        }

    }

    public setParent(parent: GloverPlatform): void {
        this.parent = parent;
    }

    public pushDutyCycle(framesOff: number, framesOn: number) {
        this.dutyCycles.push(framesOff * SRC_FRAME_TO_MS);
        this.dutyCycles.push(framesOn * SRC_FRAME_TO_MS);
    }

    public clearDutyCycle() {
        this.dutyCycles = []
    }

    public oneshotRun(frames: number) {
        this.active = true;
        this.dutyAdvance = frames * SRC_FRAME_TO_MS;
    }

    public advanceDutyCycle(frames: number) {
        for (let x = 0; x < frames; x += 1) {
            this.dutyAdvance -= SRC_FRAME_TO_MS;
            if (this.dutyAdvance < 0) {
                this.dutyAdvance = this.dutyCycles[this.dutyNextIdx];
                this.active = (this.dutyNextIdx & 1) === 1;
                this.dutyNextIdx = (this.dutyNextIdx + 1) % this.dutyCycles.length;
            }
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible) {
            return;
        }

        if (this.dutyAdvance > 0) {
            this.dutyAdvance -= viewerInput.deltaTime;
        } else {
            if (this.dutyCycles.length > 0) {
                this.dutyAdvance = this.dutyCycles[this.dutyNextIdx];
                this.active = (this.dutyNextIdx & 1) === 1;
                this.dutyNextIdx = (this.dutyNextIdx + 1) % this.dutyCycles.length;
            } else {
                this.active = false;
            }
        }


        if (this.active) {
            this.lastFrameAdvance += viewerInput.deltaTime;
            if (this.lastFrameAdvance > SRC_FRAME_TO_MS) {
                this.lastFrameAdvance = 0;


                if (this.type === 8) {
                    if (Math.floor(Math.random()*10) < 5) {
                        let particleOrigin = this.position.slice();
                        let particleVelocity = this.velocity.slice();
                        particleVelocity[1] += 1;
                        particleOrigin[0] += Math.floor(Math.random()*10) - 5;
                        particleOrigin[1] += Math.floor(Math.random()*10) - 5;
                        particleOrigin[2] += Math.floor(Math.random()*10) - 5;
                        this.particles!.spawn(particleOrigin, particleVelocity);
                    }
                }

                if (this.bullets !== null) {
                    let finalPos = this.position;
                    if (this.parent !== null) {
                        finalPos = this.scratchVec3;
                        vec3.add(finalPos, this.position, this.parent.getPosition());
                    }
                    const bullet = this.bullets.spawn(finalPos);
                    vec3.copy(bullet.velocity, this.velocity);
                    if (this.bullets.bulletType != 0x12) {
                        bullet.velocity[0] += (Math.floor(Math.random()*11) - 5) / 20.0;
                        bullet.velocity[1] += (Math.floor(Math.random()*11) - 5) / 20.0;
                        bullet.velocity[2] += (Math.floor(Math.random()*11) - 5) / 20.0;
                    }
                }

            }
        }

        if (this.particles !== null) {
            this.particles.prepareToRender(device, renderInstManager, viewerInput);
        }
        if (this.bullets !== null) {
            this.bullets.prepareToRender(device, renderInstManager, viewerInput);
        }

    }

}

class GloverBuzzer implements GenericRenderable {
    public visible: boolean = true;

    private arcRenderers: GloverElectricityRenderer[] = [];

    private pt1: vec3 | GloverPlatform = vec3.create();
    private pt2: vec3 | GloverPlatform = vec3.create();

    private scratchVec3: vec3 = vec3.create();

    private lastFrameAdvance: number = 0;

    private dutyCycles: number[] = [];
    private dutyAdvance: number = 0;
    private dutyNextIdx: number = 0;

    public active: boolean = true;

    constructor(device: GfxDevice, cache: GfxRenderCache, textureHolder: GloverTextureHolder,
        thickness: number, diameter: number, flags: number, color: Color, colorJitter: number)
    {
        switch (flags & 0x3) {
            case 0x1: var widthStyle = ElectricityThicknessStyle.Linear; break;
            case 0x2: var widthStyle = ElectricityThicknessStyle.Parabolic; break;
            default: var widthStyle = ElectricityThicknessStyle.Constant; break;
        }
        switch (flags & 0xc) {
            case 0x4: var randStyle = ElectricityRandStyle.Straight; break;
            case 0x8: var randStyle = ElectricityRandStyle.CurveUp; break;
            default: var randStyle = ElectricityRandStyle.CurveDown; break;
        }

        let flash = (flags & 0x10) !== 0;

        for (let x = 0; x < 2; x++) {
            this.arcRenderers.push(new GloverElectricityRenderer(
                device, cache, textureHolder, widthStyle, randStyle, thickness, diameter, color, colorJitter, flash, 13));
        }
    }

    public pushDutyCycle(framesOff: number, framesOn: number) {
        this.dutyCycles.push(framesOff * SRC_FRAME_TO_MS);
        this.dutyCycles.push(framesOn * SRC_FRAME_TO_MS);
    }

    public reposition(pt1: vec3 | GloverPlatform | null, pt2: vec3 | GloverPlatform | null) {
        if (pt1 !== null) {
            this.pt1 = pt1;
        }
        if (pt2 !== null) {
            this.pt2 = pt2;
        }
        this.updateGeometry();
    }

    private updateGeometry() {
        let finalPt1 = this.pt1;
        let finalPt2 = this.pt2;
        if (finalPt1 instanceof GloverPlatform) {
            finalPt1 = finalPt1.getPosition();
        }
        if (finalPt2 instanceof GloverPlatform) {
            finalPt2 = finalPt2.getPosition();
        }
        let numSegs = vec3.distance(finalPt2, finalPt1) / 10;
        if (numSegs < 5) {
            numSegs = 5;
        } else if (numSegs > 13) {
            numSegs = 13;
        }
        for (let renderer of this.arcRenderers) {
            renderer.reposition(finalPt1, finalPt2, numSegs);
        }
    }
    public destroy(device: GfxDevice): void {
        for (let renderer of this.arcRenderers) {
            renderer.destroy(device);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible) {
            return;
        }

        if (this.dutyCycles.length > 0) {
            this.dutyAdvance -= viewerInput.deltaTime;
            if (this.dutyAdvance < 0) {
                this.dutyAdvance = this.dutyCycles[this.dutyNextIdx];
                this.active = (this.dutyNextIdx & 1) === 1;
                this.dutyNextIdx = (this.dutyNextIdx + 1) % this.dutyCycles.length;
            }
        }

        this.lastFrameAdvance += viewerInput.deltaTime;
        if (this.lastFrameAdvance >= SRC_FRAME_TO_MS) {
            this.lastFrameAdvance = 0;
            if (this.pt1 instanceof GloverPlatform || this.pt2 instanceof GloverPlatform) {
                this.updateGeometry();
            }                
        }

        if (this.active) {
            for (let renderer of this.arcRenderers) {
                renderer.prepareToRender(device, renderInstManager, viewerInput);
            }
        }
    }
}

class PlatformPathPoint {
    constructor(public pos: vec3, public duration: number) {}

    public toString() {
        return "PathPoint("+this.pos+","+this.duration+")";
    }
}

type PathCallbackFunc = (plat: GloverPlatform, idx: number) => void;

export class GloverPlatform implements Shadows.ShadowCaster {

    private scratchMatrix = mat4.create();
    private scratchVec3 = vec3.create();
    private scratchVec3_2 = vec3.create();

    public shadow: Shadows.Shadow | null = null;
    public shadowSize: number | Shadows.ConstantShadowSize = 0;

    public linkedTransform: mat4 | null = null;

    // Sparkle

    private exitSparkle = false;
    private exitSparkleFrame = false;
    private exitSparkleParticles: ParticlePool;
    private static exitSparkleEmitTheta = 0; // Static across all exits, as per engine

    // Spin

    private initialEulers = vec3.fromValues(0,0,0);
    private spinSpeed = vec3.fromValues(0,0,0);
    private spinEnabled = [false, false, false];
    private rockingDeceleration = 0.0;
    private lastRockingAdvance: number = 0;
    private nextEulers = vec3.fromValues(0,0,0);
    private lastEulers = vec3.fromValues(0,0,0);

    private spinFlip = false;
    private spinFlipTheta = 0;
    private spinFlipCooldownReset = 0;
    private spinFlipCooldownTimer = 0;

    public copySpinFromParent = false;

    private blur: GloverBlurRenderer | null = null;
    private blurWidth: number = 0;
    private blurExtent:number = 0;

    // Orbit

    private orbitPt = vec3.fromValues(0,0,0);
    private orbitEnabled = [false, false, false];
    private orbitSpeed = 0.0;

    private orbitPauseCurDuration = 0.0;
    private orbitPauseDuration = 0.0;
    private orbitPauseNumStops = 0;
    private orbitPauseCurStop = 1;
    private orbitPauseWaiting = false;

    // General actor state

    private eulers = vec3.fromValues(0,0,0);
    private rotation = quat.create();
    private position = vec3.fromValues(0,0,0);
    private velocity = vec3.fromValues(0,0,0);
    private scale = vec3.fromValues(1,1,1);

    private globalRotation = quat.create();
    private globalPosition = vec3.fromValues(0,0,0);

    public parent: GloverPlatform | undefined = undefined;

    public get visible(): boolean {
        if (this.actor === null) {
            return false;
        } else {
            return this.actor.visible;
        }
    }

    public set visible(val: boolean) {
        if (this.actor !== null) {
            this.actor.visible = val;
        }
    }

    // Path
    
    public path : PlatformPathPoint[] = [];
    private pathDirection : number = 1;
    private pathTimeLeft : number = 0;
    private pathCurPt : number = 0;
    private pathPaused : boolean = false;
    private pathCallbacks : PathCallbackFunc[] = [];
    public pathAccel : number = 0;
    public pathMaxVel : number = NaN;
    private lastPathAdvance: number = 0;

    private lastPosition = vec3.fromValues(0,0,0);
    private nextPosition = vec3.fromValues(0,0,0);

    // Conveyor

    private conveyorVel : vec3 | null = null;

    // Implementation

    constructor(
        public actor: GloverActorRenderer | null)
    { }

    public initExitSparkle(): ParticlePool {
        assert(this.actor !== null);
        assert(this.exitSparkle == false);
        this.exitSparkle = true;
        this.exitSparkleParticles = new ParticlePool(
            this.actor.device, this.actor.cache, this.actor.textures, 0x15);
        return this.exitSparkleParticles;
    }

    public pushPathPoint(point: PlatformPathPoint) {
        this.path.push(point);
        if (this.path.length == 1) {
            this.setPosition(point.pos[0], point.pos[1], point.pos[2]);
            vec3.copy(this.lastPosition, this.position);
            vec3.copy(this.nextPosition, this.position);
            this.pathTimeLeft = point.duration;
            this.pathPaused = point.duration < 0;
            this.updateModelMatrix();
        }
    }

    public pushPathCallback(callback: PathCallbackFunc) {
        this.pathCallbacks.push(callback);
    }

    public setPosition(x: number, y: number, z: number) {
        this.position[0] = x;
        this.position[1] = y;
        this.position[2] = z;
    }

    public getPosition(): vec3 {
        return this.globalPosition;
    }


    public setScale(x: number, y: number, z: number) {
        this.scale[0] = x;
        this.scale[1] = y;
        this.scale[2] = z;
        if (this.actor !== null) {
            this.actor.rootMesh.renderer.conveyorScaleX = this.scale[0];
            this.actor.rootMesh.renderer.conveyorScaleZ = this.scale[2];
        }
    }

    public setConveyor(vel: vec3) {
        this.conveyorVel = vel;
        if (this.actor !== null) {
            this.actor.rootMesh.renderer.conveyorX = -this.conveyorVel[0];
            this.actor.rootMesh.renderer.conveyorZ = -this.conveyorVel[2];
            this.actor.rootMesh.renderer.conveyorScaleX = this.scale[0];
            this.actor.rootMesh.renderer.conveyorScaleZ = this.scale[2];
        }
    }

    public setConstantSpin(axis: number, initial_theta: number, speed: number) {
        this.eulers[axis] = initial_theta;
        this.initialEulers[axis] = initial_theta;
        this.spinSpeed[axis] = -speed / SRC_FRAME_TO_MS;
        this.rockingDeceleration = 0.0;
        this.spinEnabled[axis] = true;
    }

    public setSpinFlip(theta: number, cooldownTimer: number) {
        if (cooldownTimer == 0) {
            cooldownTimer = 5;
        }
        this.spinFlip = true;
        this.spinFlipTheta = theta;
        for (let axis = 0; axis < 3; axis += 1) {
            this.eulers[axis] -= Math.PI;
            this.eulers[axis] = radianModulo(this.eulers[axis]);
        }
        this.spinFlipCooldownReset = cooldownTimer * SRC_FRAME_TO_MS;
    }

    public setRocking(axis: number, max_theta: number, decel_factor: number) {
        this.lastEulers[axis] = max_theta;
        this.nextEulers[axis] = max_theta;
        this.initialEulers[axis] = max_theta;
        this.spinSpeed[axis] = 0;
        this.rockingDeceleration = decel_factor;
        this.spinEnabled[axis] = true;
    }

    public setBlur(renderer: GloverBlurRenderer, width: number) {
        assert(this.actor !== null);
        this.blurWidth = width;
        this.blur = renderer;
        this.blurExtent = 0;
        let geo = this.actor.rootMesh.mesh.geometry;
        for (let vertex of geo.vertices) {
            if (Math.abs(vertex.y) > this.blurExtent) {
                this.blurExtent = Math.abs(vertex.y);
            }
        }
    }

    public setOrbitAroundPoint(axis: number, point: [number, number, number], speed: number) {
        this.orbitEnabled[axis] = true;
        this.orbitSpeed = speed / SRC_FRAME_TO_MS;
        vec3.copy(this.orbitPt, point);
    }

    public setOrbitPause(frames: number, pauses: number) {
        this.orbitPauseNumStops = pauses;
        this.orbitPauseDuration = frames * SRC_FRAME_TO_MS;
    }

    public advanceRocking(deltaTime: number, viewerInput: Viewer.ViewerRenderInput | null = null) {
        if (this.rockingDeceleration > 0) {
            this.lastRockingAdvance += deltaTime;
            for (let axis = 0; axis < 3; axis += 1) {
                if (!this.spinEnabled[axis]) {
                    continue;
                }
                if (this.lastRockingAdvance >= SRC_FRAME_TO_MS) {
                    this.lastEulers[axis] = this.nextEulers[axis];
                    this.spinSpeed[axis] -= subtractAngles(this.nextEulers[axis], 0) / this.rockingDeceleration;
                    this.nextEulers[axis] += this.spinSpeed[axis];
                    this.nextEulers[axis] = radianModulo(this.nextEulers[axis]);
                    if (Math.abs(this.spinSpeed[axis]) <= .0005) {
                        this.spinSpeed[axis] = 0.0;
                    }
                    break;
                }
            }
            if (this.lastRockingAdvance >= SRC_FRAME_TO_MS) {
                if (this.blur !== null) {
                    const pt1 = this.scratchVec3;
                    const pt2 = this.scratchVec3_2;
                    vec3.set(pt1, 0, -this.blurExtent, 0);
                    if (this.spinEnabled[0]) {
                        vec3.rotateX(pt1, pt1, [0,0,0], this.eulers[0]);
                    } else if (this.spinEnabled[1]) {
                        vec3.rotateY(pt1, pt1, [0,0,0], this.eulers[1]);
                    } else if (this.spinEnabled[2]) {
                        vec3.rotateZ(pt1, pt1, [0,0,0], this.eulers[2]);
                    }
                    vec3.scale(pt2, pt1, this.blurWidth);

                    vec3.add(pt1, pt1, this.globalPosition);
                    vec3.add(pt2, pt2, this.globalPosition);

                    if (viewerInput !== null) {
                        pushAlongLookatVector(pt1, pt1, 2, viewerInput);
                        pushAlongLookatVector(pt2, pt2, 2, viewerInput);
                    }

                    this.blur.pushNewPoint(pt1, pt2);
                }
                this.lastRockingAdvance -= SRC_FRAME_TO_MS;
            }
            radianLerp(this.eulers, this.lastEulers, this.nextEulers, Math.max(0,Math.min(this.lastRockingAdvance/(SRC_FRAME_TO_MS*1.1),1)));
        }

    }    

    public advanceOrbit(deltaTime: number) {
        for (let axis = 0; axis < 3; axis += 1) {
            if (!this.orbitEnabled[axis]) {
                continue;
            }
            vec3.sub(this.scratchVec3, this.position, this.orbitPt);
            let dist = 0;
            let theta = 0;
            if (axis == 0) {
                theta = Math.atan2(this.scratchVec3[1],this.scratchVec3[2]);
                dist = Math.sqrt(Math.pow(this.scratchVec3[1],2) + Math.pow(this.scratchVec3[2],2));
            } else if (axis == 1) {
                theta = Math.atan2(this.scratchVec3[0],this.scratchVec3[2]);
                dist = Math.sqrt(Math.pow(this.scratchVec3[0],2) + Math.pow(this.scratchVec3[2],2));
            } else {
                theta = Math.atan2(this.scratchVec3[0],this.scratchVec3[1]);
                dist = Math.sqrt(Math.pow(this.scratchVec3[0],2) + Math.pow(this.scratchVec3[1],2));
            }

            if (this.orbitPauseNumStops > 0) {
                if (this.orbitPauseWaiting) {
                    if (this.orbitPauseCurDuration > 0) {
                        this.orbitPauseCurDuration -= deltaTime;
                        if (this.orbitPauseCurDuration <= 0) {
                            this.orbitPauseCurDuration = SRC_FRAME_TO_MS;
                            this.orbitPauseWaiting = false;
                        }
                    }
                } else {
                    if (this.orbitPauseCurDuration > 0) {
                        this.orbitPauseCurDuration -= deltaTime;
                    } else {
                        let nextStopAngle = (this.orbitPauseCurStop/this.orbitPauseNumStops) * 2 * Math.PI;
                        let distFromStop = Math.abs(angularDistance(theta, nextStopAngle));
                        let stepDist = Math.abs(this.orbitSpeed)*deltaTime;
                        if (distFromStop < stepDist) {
                            this.orbitPauseCurDuration = this.orbitPauseDuration;
                            this.orbitPauseCurStop += 1;
                            if (this.orbitPauseCurStop >= this.orbitPauseNumStops) {
                                this.orbitPauseCurStop = 0;
                            }
                            this.orbitPauseWaiting = true;
                        }
                    }
                }
            }

            if (!this.orbitPauseWaiting) {
                theta -= this.orbitSpeed * deltaTime;
                const x = Math.cos(theta) * dist;
                const y = Math.sin(theta) * dist;
                if (axis == 0) {
                    this.position[1] = this.orbitPt[1] + y;
                    this.position[2] = this.orbitPt[2] + x;
                } else if (axis == 1) {
                    this.position[0] = this.orbitPt[0] + y;
                    this.position[2] = this.orbitPt[2] + x;
                } else {
                    this.position[0] = this.orbitPt[0] + y;
                    this.position[1] = this.orbitPt[1] + x;
                }
            }
        }
    }

    public updateModelMatrix() {
        // // In-game algorithm, rather than quat.fromEuler:
        // quat.identity(this.rotation);
        // quat.mul(this.rotation, axisRotationToQuaternion([0,1,0], this.eulers[1]), this.rotation);
        // quat.mul(this.rotation, axisRotationToQuaternion([0,0,1], Math.PI + this.eulers[0]), this.rotation);
        // quat.mul(this.rotation, axisRotationToQuaternion([1,0,0], this.eulers[2]), this.rotation);
        quat.fromEuler(this.rotation,
            this.eulers[0] * 180 / Math.PI,
            this.eulers[1] * 180 / Math.PI,
            this.eulers[2] * 180 / Math.PI);

        vec3.copy(this.globalPosition, this.position);
        quat.copy(this.globalRotation, this.rotation);
        if (this.parent !== undefined) {
            this.parent.updateModelMatrix();

            if (this.copySpinFromParent) {
                quat.mul(this.globalRotation, this.parent.globalRotation, this.globalRotation);
            }

            if (this.parent.path.length <= 1) {
                vec3.transformQuat(this.globalPosition, this.globalPosition, this.parent.globalRotation);
            }

            vec3.add(this.globalPosition, this.globalPosition, this.parent.globalPosition);
        }

        if (this.actor === null) {
            return;
        }
        mat4.fromRotationTranslationScale(this.actor.modelMatrix, this.globalRotation, this.globalPosition, this.scale);
        if (this.linkedTransform !== null) {
            mat4.mul(this.actor.modelMatrix, this.actor.modelMatrix, this.linkedTransform);
        }
    }

    public advanceFrame(deltaTime : number, viewerInput : Viewer.ViewerRenderInput | null = null): void {
        if (deltaTime == 0) {
            return;
        }
        deltaTime = Math.min(deltaTime, SRC_FRAME_TO_MS);

        if (this.exitSparkle && this.actor !== null) {
            // Only emit exit particles after scene load
            if (viewerInput !== null) {
                if (this.exitSparkleFrame) {

                    const particleVelocity = [
                        Math.cos(-GloverPlatform.exitSparkleEmitTheta) * 2,
                        12,
                        Math.sin(-GloverPlatform.exitSparkleEmitTheta) * 2
                    ];
                    GloverPlatform.exitSparkleEmitTheta += 0.4;

                    mat4.getTranslation(this.scratchVec3, this.actor.modelMatrix);
                    const particleOrigin1 = [
                        this.scratchVec3[0] + particleVelocity[0] * 9.0,
                        this.scratchVec3[1] + 4.0,
                        this.scratchVec3[2] + particleVelocity[2] * 9.0,
                    ]
                    const particleOrigin2 = [
                        this.scratchVec3[0] - particleVelocity[0] * 9.0,
                        this.scratchVec3[1] + 4.0,
                        this.scratchVec3[2] - particleVelocity[2] * 9.0,
                    ]

                    spawnExitParticle(this.exitSparkleParticles, particleOrigin1, particleVelocity, 1.0);

                    particleVelocity[0] *= -1;
                    particleVelocity[2] *= -1;

                    spawnExitParticle(this.exitSparkleParticles, particleOrigin2, particleVelocity, 1.0);
                }
                this.exitSparkleFrame = !this.exitSparkleFrame;
            }
        }

        let curSpeed = vec3.length(this.velocity);

        if (this.path.length > 0 && this.pathMaxVel > 0) {
            if (this.lastPathAdvance >= SRC_FRAME_TO_MS) {

                vec3.copy(this.lastPosition, this.nextPosition);

                if (!this.pathPaused) {
                    const dstPt = this.path[this.pathCurPt].pos;
                    const journeyVector = this.scratchVec3;
                    vec3.sub(journeyVector, dstPt, this.lastPosition);
                    const distRemaining = vec3.length(journeyVector);
                    vec3.normalize(journeyVector, journeyVector);

                    const speedCutoff = ((this.pathAccel + curSpeed) * curSpeed) / (2*this.pathAccel);
                    if (speedCutoff > distRemaining) {
                        vec3.scaleAndAdd(this.velocity, this.velocity, journeyVector, -this.pathAccel);
                    } else {
                        vec3.scaleAndAdd(this.velocity, this.velocity, journeyVector, this.pathAccel);
                    }

                    if (!isNaN(this.pathMaxVel) && curSpeed > this.pathMaxVel) {
                        vec3.scale(this.velocity, this.velocity, this.pathMaxVel / curSpeed);
                    }
                    curSpeed = vec3.length(this.velocity);

                    if (this.pathTimeLeft > 0) {
                        this.pathTimeLeft -= 1;
                    }

                    if (distRemaining < curSpeed + 0.01) {
                        if (this.pathTimeLeft == 0) {
                            this.pathCurPt = (this.pathCurPt + this.pathDirection) % this.path.length;
                            this.pathTimeLeft = this.path[this.pathCurPt].duration;
                            this.pathPaused = this.path[this.pathCurPt].duration < 0;
                        }
                        if (this.pathCallbacks.length > 0 && curSpeed > 0) {
                            for (let callback of this.pathCallbacks) {
                                callback(this, this.pathCurPt);
                            }
                        }
                        vec3.copy(this.nextPosition, dstPt);
                        vec3.zero(this.velocity);
                        curSpeed = 0;
                    }                
                }

                vec3.add(this.nextPosition, this.nextPosition, this.velocity);

                this.lastPathAdvance = 0;
            } else {
                this.lastPathAdvance += deltaTime;
            }

            vec3.lerp(this.position, this.lastPosition, this.nextPosition, Math.min(1.0, this.lastPathAdvance/(SRC_FRAME_TO_MS*1.1)));

        } else {
            this.advanceOrbit(deltaTime);
        }

        if (this.rockingDeceleration > 0.0) {
            this.advanceRocking(deltaTime, viewerInput);
        } else {
            if (this.spinFlip) {
                if (this.spinFlipCooldownTimer <= 0) {
                    for (let axis = 0; axis < 3; axis += 1) {
                        if (!this.spinEnabled[axis]) continue;

                        let travelDist = this.initialEulers[axis] - this.eulers[axis];
                        if (this.spinSpeed[axis] < 0) {
                            travelDist *= -1;
                        }
                        travelDist = radianModulo(Math.PI - travelDist);

                        const frameTravelDist = Math.abs(this.spinSpeed[axis] * deltaTime);
                        // console.log(travelDist*180/Math.PI, this.spinFlipTheta*180/Math.PI, angularDistance(travelDist, this.spinFlipTheta)*180/Math.PI, angularDistance(Math.PI*2 - this.spinFlipTheta, travelDist)*180/Math.PI, frameTravelDist*180/Math.PI)
                        if (angularDistance(travelDist, this.spinFlipTheta) <= frameTravelDist ||
                            angularDistance(Math.PI*2 - this.spinFlipTheta, travelDist) <= frameTravelDist)
                        {
                            // const r2d = 180/Math.PI
                            // console.log(travelDist * r2d, angularDistance(travelDist, this.spinFlipTheta) * r2d, angularDistance(Math.PI*2 - this.spinFlipTheta, travelDist) * r2d);
                            this.spinSpeed[axis] *= -1;
                            this.spinFlipCooldownTimer = this.spinFlipCooldownReset;
                        }
                        break;
                    }
                } else {
                    this.spinFlipCooldownTimer -= deltaTime;
                }
            }
            this.eulers[0] += this.spinSpeed[0] * deltaTime;
            this.eulers[1] += this.spinSpeed[1] * deltaTime;
            this.eulers[2] += this.spinSpeed[2] * deltaTime;
            this.eulers[0] = radianModulo(this.eulers[0]);
            this.eulers[1] = radianModulo(this.eulers[1]);
            this.eulers[2] = radianModulo(this.eulers[2]);
        }

        this.updateModelMatrix()
    }
}

enum CollectibleSparkleType {
  ExtraLife,
  Powerup
}
export class CollectibleSparkle implements GenericRenderable {

    private particles: ParticlePool;

    private lastFrameAdvance: number = 0;
    private frameCount: number = 0;

    private static velocity = [0,0,0];

    public visible: boolean = true;

    constructor(device: GfxDevice, cache: GfxRenderCache, textureHolder: GloverTextureHolder, private position: vec3, private type: CollectibleSparkleType) {
        this.particles = new ParticlePool(device, cache, textureHolder, 6);
    }

    public destroy(device: GfxDevice): void {
        this.particles.destroy(device);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible) {
            return;
        }

        this.lastFrameAdvance += viewerInput.deltaTime;
        if (this.lastFrameAdvance > 50) {
            this.lastFrameAdvance = 0;
            this.frameCount += 1;

            let particleOrigin = this.position.slice();
            if (this.type === CollectibleSparkleType.ExtraLife) {
                particleOrigin[0] -= Math.sin(-this.frameCount/3.0) * 10;
                particleOrigin[1] += Math.sin(this.frameCount/5.0) * 5;
                particleOrigin[2] += Math.cos(-this.frameCount/3.0) * 10;
            } else if (this.type === CollectibleSparkleType.Powerup) {
                particleOrigin[0] -= Math.sin(-this.frameCount/3.0) * 14;
                particleOrigin[1] += Math.sin(this.frameCount/5.0) * 5 + Math.floor(Math.random()*5) - 2;
                particleOrigin[2] += Math.cos(-this.frameCount/3.0) * 14;
            }
            const particle = this.particles.spawn(particleOrigin, CollectibleSparkle.velocity);
            particle.setLifetime(10);
        }

        this.particles.prepareToRender(device, renderInstManager, viewerInput);
    }
}

export class GloverWind implements GenericRenderable {

    private particles: ParticlePool;

    private lastFrameAdvance: number = 0;

    public visible: boolean = true;

    private scratchOrigin: vec3 = vec3.create();
    private scratchVelocity: vec3 = vec3.create();

    constructor(device: GfxDevice, cache: GfxRenderCache, textureHolder: GloverTextureHolder, waterVolumes: GloverWaterVolume[],
        private ltf: vec3, private whd: vec3, private velocity: vec3, private turbulence: number) {
        this.particles = new ParticlePool(device, cache, textureHolder, 0x10, waterVolumes);
    }

    public destroy(device: GfxDevice): void {
        this.particles.destroy(device);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible) {
            return;
        }

        this.lastFrameAdvance += viewerInput.deltaTime;
        if (this.lastFrameAdvance > SRC_FRAME_TO_MS * 2) {
            this.lastFrameAdvance = 0;

            for (let i = 0; i < this.turbulence; i++) {
                const jitter = this.turbulence * (Math.floor(Math.random()*10)/4 + 12);
                let lifetime = 0;
                for (let axis = 0; axis < 3; axis++) {
                    if (this.scratchVelocity[axis] == 0) {
                        this.scratchOrigin[axis] = Math.floor(Math.random() * this.whd[axis]);
                    } else {
                        lifetime = Math.max(lifetime, this.whd[axis] / jitter);
                        if (this.scratchVelocity[axis] < 0) {
                            this.scratchOrigin[axis] = this.whd[axis]
                        } else {
                            this.scratchOrigin[axis] = 0;
                        }
                    }
                }
                vec3.add(this.scratchOrigin, this.scratchOrigin, this.ltf);
                vec3.scale(this.scratchVelocity, this.velocity, jitter)
                const particle = this.particles.spawn(this.scratchOrigin, this.scratchVelocity);
                particle.setLifetime(lifetime);
                if (Math.random() <= 0.5) {
                    particle.scale[0] = -1;
                }
            }
        }

        this.particles.prepareToRender(device, renderInstManager, viewerInput);
    }

}


const identityRotation: quat = quat.create();

export class GloverMrTip implements Shadows.ShadowCaster {
    public shadow: Shadows.Shadow | null = null;
    public shadowSize: number | Shadows.ConstantShadowSize = 8;

    private mainBillboard: GloverSpriteRenderer;

    private lastFrameAdvance: number = 0;
    private frameCount: number = 0;
    private curFrame: number = 0;

    private scale = vec3.fromValues(1,1,1);

    private yOffset = 0;

    private scratchVec3 = vec3.create();

    private particles: ParticlePool;

    private drawMatrix: mat4 = mat4.create();

    public visible: boolean = true;

    private static primColor = {r: 1, g: 1, b: 1, a: 0.94};

    constructor(device: GfxDevice, cache: GfxRenderCache, textureHolder: GloverTextureHolder, private position: vec3) {
        this.mainBillboard = new GloverSpriteRenderer(device, cache, textureHolder,
            [0x6D419194, 0x8C641CE9], true);
        this.yOffset = Math.floor(Math.random()*5000);
        this.particles = new ParticlePool(device, cache, textureHolder, 7);
        mat4.fromTranslation(this.drawMatrix, this.position);
    }

    public getPosition(): vec3 {
        return this.position;
    }

    public destroy(device: GfxDevice): void {
        this.mainBillboard.destroy(device);
        this.particles.destroy(device);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        
        this.lastFrameAdvance += viewerInput.deltaTime;
        if (this.lastFrameAdvance > 50) {
            this.lastFrameAdvance = 0;
            this.frameCount += 1;
            const blink = Math.floor(Math.random() * 0x14);
            if (blink == 1) {
                this.curFrame = 1;
            } else {
                this.curFrame = 0;
            }
            if ((this.frameCount & 1) != 0) {
                const particleOrigin = [
                    this.position[0] + Math.floor(Math.random()*7) - 3,
                    this.position[1] + 5,
                    this.position[2] + Math.floor(Math.random()*7) - 3,
                ]
                const particleVelocity = [
                    Math.cos(-this.frameCount),
                    -.5,
                    Math.sin(-this.frameCount),
                ]
                this.particles.spawn(particleOrigin, particleVelocity);
            }
        }

        this.scale[0] = (Math.sin(viewerInput.time/250) * 10 + 48) / 3;
        this.scale[1] = (48 - Math.sin(viewerInput.time/250) * 10) / 3;

        const finalPosition = this.scratchVec3;
        vec3.add(finalPosition, this.position, [0,Math.sin((this.yOffset + viewerInput.time)/300)*4+10,0]);

        mat4.fromRotationTranslationScale(this.drawMatrix, identityRotation, finalPosition, this.scale);

        if (!this.visible) {
            return;
        }

        this.mainBillboard.prepareToRender(device, renderInstManager, viewerInput, this.drawMatrix, this.curFrame, GloverMrTip.primColor);
        this.particles.prepareToRender(device, renderInstManager, viewerInput);
    }
}


class GloverRenderer implements Viewer.SceneGfx {
    public actors: GloverActorRenderer[] = [];
    public backdrops: GloverBackdropRenderer[] = [];
    public flipbooks: GloverFlipbookRenderer[] = [];

    public miscRenderers: GenericRenderable[] = [];
    public weather: GloverWeatherRenderer | null = null;
    public mrtips: GloverMrTip[] = [];
    public shadows: Shadows.Shadow[] = [];
    public platforms: GloverPlatform[] = [];
    public platformByTag = new Map<number, GloverPlatform>();

    public waterVolumes: GloverWaterVolume[] = [];

    public sceneLights: SceneLighting = new SceneLighting();

    public renderHelper: GfxRenderHelper;

    public renderPassDescriptor = standardFullClearRenderPassDescriptor; 

    private initTime: number;

    private originalVisibility = new Map<Object, boolean>();

    constructor(device: GfxDevice, public textureHolder: GloverTextureHolder) {
        this.renderHelper = new GfxRenderHelper(device);
        this.initTime = Date.now();
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(10/60);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();

        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');

        const hideDynamicsCheckbox = new UI.Checkbox('Hide dynamic objects', false);
        hideDynamicsCheckbox.onchanged = () => {
            for (let platform of this.platforms) {
                if (platform.actor !== null) {
                    platform.actor.visible = !hideDynamicsCheckbox.checked;
                }
            }
        };
        renderHacksPanel.contents.appendChild(hideDynamicsCheckbox.elem);

        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (let actor of this.actors) {
                actor.setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
            }
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);

        const forceBackfaceCullingCheckbox = new UI.Checkbox('Force Backface Culling', false);
        forceBackfaceCullingCheckbox.onchanged = () => {
            for (let actor of this.actors) {
                actor.setBackfaceCullingEnabled(forceBackfaceCullingCheckbox.checked);
            }
        };
        renderHacksPanel.contents.appendChild(forceBackfaceCullingCheckbox.elem);

        const madGaribsCheckbox = new UI.Checkbox('Mad garibs', false);
        madGaribsCheckbox.onchanged = () => {
            // C-Down, C-Right, C-Down, C-Up, C-Left, C-Down, C-Left, C-Up
            const flipbookMetadata = madGaribsCheckbox.checked ? collectibleFlipbooks[3] : collectibleFlipbooks[0];
            for (let flipbook of this.flipbooks) {
                if (flipbook.isGarib) {
                    flipbook.setSprite(flipbookMetadata!);
                }
            }
        };
        renderHacksPanel.contents.appendChild(madGaribsCheckbox.elem);


        const showHiddenCheckbox = new UI.Checkbox('Show hidden objects', false);
        showHiddenCheckbox.onchanged = () => {
            if (showHiddenCheckbox.checked === true) {
                for (let platform of this.platforms) {
                    if (platform.actor !== null) {
                        this.originalVisibility.set(platform.actor, platform.actor.visible);
                        platform.actor.visible = true;
                    }
                }
                for (let renderer of this.flipbooks) {
                    this.originalVisibility.set(renderer, renderer.visible);
                    renderer.visible = true;
                }
                for (let renderer of this.shadows) {
                    this.originalVisibility.set(renderer, renderer.visible);
                    renderer.visible = true;
                }
                for (let renderer of this.miscRenderers) {
                    this.originalVisibility.set(renderer, renderer.visible);
                    renderer.visible = true;
                }
            } else {
                for (let platform of this.platforms) {
                    if (platform.actor !== null) {
                        platform.actor.visible = this.originalVisibility.get(platform.actor)!;
                    }
                }
                for (let renderer of this.flipbooks) {
                    renderer.visible = this.originalVisibility.get(renderer)!;
                }
                for (let renderer of this.shadows) {
                    renderer.visible = this.originalVisibility.get(renderer)!;
                }
                for (let renderer of this.miscRenderers) {
                    renderer.visible = this.originalVisibility.get(renderer)!;
                }
            }
        };
        renderHacksPanel.contents.appendChild(showHiddenCheckbox.elem);

        const hideWeatherCheckbox = new UI.Checkbox('Disable weather effects', false);
        hideWeatherCheckbox.onchanged = () => {
            if (this.weather !== null) {
                this.weather.visible = !hideWeatherCheckbox.checked;
            }
        };
        renderHacksPanel.contents.appendChild(hideWeatherCheckbox.elem);

        // TODO: remove:
        // const enableDebugInfoCheckbox = new UI.Checkbox('Show object names', false);
        // enableDebugInfoCheckbox.onchanged = () => {
        //     for (let actor of this.actors) {
        //         actor.setDebugInfoVisible(enableDebugInfoCheckbox.checked);
        //     }
        // };
        // renderHacksPanel.contents.appendChild(enableDebugInfoCheckbox.elem);

        return [renderHacksPanel];

    }

    public prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();

        this.textureHolder.animatePalettes(viewerInput);

        for (let platform of this.platforms) {
            platform.advanceFrame(viewerInput.deltaTime, viewerInput);
        }

        for (let renderer of this.backdrops) {
            renderer.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        }
        for (let renderer of this.actors) {
            renderer.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
            
            // TODO: remove
            // let pos = vec3.fromValues(
            //     renderer.modelMatrix[12],
            //     renderer.modelMatrix[13],
            //     renderer.modelMatrix[14],
            // );
            // drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, pos, renderer.actorObject.objId.toString(16), 0, White, { outline: 6 });
        }
        for (let renderer of this.shadows) {
            renderer.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        }
        for (let renderer of this.flipbooks) {
            renderer.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        }
        for (let renderer of this.mrtips) {
            renderer.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        }
        for (let renderer of this.miscRenderers) {
            renderer.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        }
        if (this.weather !== null) {
            this.weather.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        }

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) : void {
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, this.renderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, this.renderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstManager.drawOnPassRenderer(passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);

        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();

        Shadows.Shadow.destroyRenderer(device);

        for (let renderer of this.actors) {
            renderer.destroy(device);
        }
        for (let renderer of this.backdrops) {
            renderer.destroy(device);
        }
        for (let renderer of this.flipbooks) {
            renderer.destroy(device);
        }
        for (let renderer of this.miscRenderers) {
            renderer.destroy(device);
        }
        for (let renderer of this.mrtips) {
            renderer.destroy(device);
        }
        if (this.weather !== null) {
            this.weather.destroy(device);
        }
        this.textureHolder.destroy(device);
    }
}

interface GloverSceneBankDescriptor {
    landscape: string,
    object_banks: string[],
    texture_banks: string[],
    backdrop_primitive_color?: number[],
    weather?: WeatherParams
};

const prehistoric_snow: WeatherParams = {
    type: WeatherType.Snow,
    iterations_per_frame: 0x40,
    particles_per_iteration: 1,
    lifetime: 0xFFFF,
    alphas: [0xDC, 0x96, 0x50],
    velocity: [0, 248],
    particle_lifetime_min: 100
}

const fortress_rain: WeatherParams = {
    type: WeatherType.Rain,
    iterations_per_frame: 0x40,
    particles_per_iteration: 5,
    lifetime: 0xFFFF,
    alphas: [0x78, 0x50, 0x3C],
    velocity: [226, 248],
    particle_lifetime_min: 7
}

// Level ID to bank information
const sceneBanks = new Map<string, GloverSceneBankDescriptor>([
    ["00", {
        landscape: "00.HUB1ln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART1.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"],
        backdrop_primitive_color: [0xff, 0xff, 0xff, 0xff]
    }], //"Hub 1"),
    ["01", {
        landscape: "01.HUB2ln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART2.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"],
        backdrop_primitive_color: [0xff, 0xff, 0xff, 0xff]
    }], //"Hub 2"),
    ["02", {
        landscape: "02.HUB3ln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART3.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"],
        backdrop_primitive_color: [0xff, 0x3c, 0x00, 0xff]
    }], //"Hub 3"),
    ["03", {
        landscape: "03.HUB4ln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART4.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"],
        backdrop_primitive_color: [0xff, 0x80, 0x00, 0xff]
    }], //"Hub 4"),
    ["04", {
        landscape: "04.HUB5ln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART5.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"],
        backdrop_primitive_color: [0xc8, 0xc8, 0xff, 0xff]
    }], //"Hub 5"),
    ["05", {
        landscape: "05.HUB6ln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART6.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"],
        backdrop_primitive_color: [0xe6, 0xff, 0xff, 0xff]
    }], //"Hub 6"),
    ["06", {
        landscape: "06.HUB7ln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART7.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"],
        backdrop_primitive_color: [0xff, 0xff, 0xff, 0x64]
    }], //"Hub 7"),
    ["07", {
        landscape: "07.HUB8ln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART8.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"],
        backdrop_primitive_color: [0xff, 0xff, 0xff, 0xff]
    }], //"Hub 8"),

    ["08", {
        landscape: "08.CAVEln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "CAVE.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"]
    }], //"Castle Cave"),
    ["09", {
        landscape: "09.ACOURSE.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "ASSAULT COURSE.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"]
    }], //"Assault Course"),
    ["2a", {
        landscape: "42.WAYROOM.n64.lev",
        object_banks: ["GENERIC.obj.fla", "WAYROOM.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"]
    }], //"Wayroom"),
    /////////////////////////////////////////////////////////


    ["0a", {
        landscape: "10.AT1lnd.n64.lev",
        object_banks: ["GENERIC.obj.fla", "ATLANTIS_SHARED.obj.fla", "ATLANTIS_L1.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "ATLANTIS_TEX_BANK.tex.fla"]}],
    ["0b", {
        landscape: "11.AT2lnd.n64.lev",
        object_banks: ["GENERIC.obj.fla", "ATLANTIS_SHARED.obj.fla", "ATLANTIS_L2.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "ATLANTIS_TEX_BANK.tex.fla"]}],
    ["0c", {
        landscape: "12.AT3Aln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "ATLANTIS_SHARED.obj.fla", "ATLANTIS_L3A.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "ATLANTIS_TEX_BANK.tex.fla"]}],
    ["0d", {
        landscape: "13.ATBOSS.n64.lev",
        object_banks: ["GENERIC.obj.fla", "ATLANTIS_SHARED.obj.fla", "ATLANTIS_BOSS.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "ATLANTIS_TEX_BANK.tex.fla"]}],
    ["0e", {
        landscape: "14.ATBONUS.n64.lev",
        object_banks: ["GENERIC.obj.fla", "ATLANTIS_SHARED.obj.fla", "ATLANTIS_BONUS.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "ATLANTIS_TEX_BANK.tex.fla"]}],

    ["0f", {
        landscape: "15.CK1lnd.n64.lev",
        object_banks: ["GENERIC.obj.fla", "CARNIVAL_SHARED.obj.fla", "CARNIVAL_L1.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "CARNIVAL_TEX_BANK.tex.fla"]}],
    ["10", {
        landscape: "16.CK2Aln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "CARNIVAL_SHARED.obj.fla", "CARNIVAL_L2A.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "CARNIVAL_TEX_BANK.tex.fla"]}],
    ["11", {
        landscape: "17.CK3Aln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "CARNIVAL_SHARED.obj.fla", "CARNIVAL_L3A.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "CARNIVAL_TEX_BANK.tex.fla"]}],
    ["12", {
        landscape: "18.CKBOSS.n64.lev",
        object_banks: ["GENERIC.obj.fla", "CARNIVAL_SHARED.obj.fla", "CARNIVAL_BOSS.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "CARNIVAL_TEX_BANK.tex.fla"]}],
    ["13", { // TODO: figure out cheat code/easter egg bank hackery
        landscape: "19.CKBONUS.n64.lev",
        object_banks: ["GENERIC.obj.fla", "CARNIVAL_SHARED.obj.fla", "CARNIVAL_BONUS.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "CARNIVAL_TEX_BANK.tex.fla", "CKBONUS_TEX_BANK.tex.fla"]}],
    ["14", {
        landscape: "20.PC1lnd.n64.lev",
        object_banks: ["GENERIC.obj.fla", "PIRATES_SHARED.obj.fla", "PIRATES_L1.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PIRATES_TEX_BANK.tex.fla"]
    }],
    ["15", {
        landscape: "21.PC2Aln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "PIRATES_SHARED.obj.fla", "PIRATES_L2A.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PIRATES_TEX_BANK.tex.fla"]
    }],
    ["16", {
        landscape: "22.PC3Bln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "PIRATES_SHARED.obj.fla", "PIRATES_L3B.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PIRATES_TEX_BANK.tex.fla"]
    }],
    ["17", {
        landscape: "23.PCBOSS.n64.lev",
        object_banks: ["GENERIC.obj.fla", "PIRATES_SHARED.obj.fla", "PIRATES_BOSS.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PIRATES_TEX_BANK.tex.fla"]
    }],
    ["18", {
        landscape: "24.PCBONUS.n64.lev",
        object_banks: ["GENERIC.obj.fla", "PIRATES_SHARED.obj.fla", "PIRATES_BONUS.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PIRATES_TEX_BANK.tex.fla"]
    }],
    ["19", {
        landscape: "25.PH1Aln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "PREHISTORIC_SHARED.obj.fla", "PREHISTORIC_L1A.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PREHISTORIC_TEX_BANK.tex.fla"],
        weather: prehistoric_snow
    }],
    ["1a", {
        landscape: "26.PH2Aln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "PREHISTORIC_SHARED.obj.fla", "PREHISTORIC_L2A.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PREHISTORIC_TEX_BANK.tex.fla"]
    }],
    ["1b", {
        landscape: "27.PH3Bln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "PREHISTORIC_SHARED.obj.fla", "PREHISTORIC_L3B.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PREHISTORIC_TEX_BANK.tex.fla"]
    }],
    ["1c", {
        landscape: "28.PHBOSS.n64.lev",
        object_banks: ["GENERIC.obj.fla", "PREHISTORIC_SHARED.obj.fla", "PREHISTORIC_BOSS.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PREHISTORIC_TEX_BANK.tex.fla"],
        weather: prehistoric_snow
    }],
    ["1d", {
        landscape: "29.PHBONUS.n64.lev",
        object_banks: ["GENERIC.obj.fla", "PREHISTORIC_SHARED.obj.fla", "PREHISTORIC_BONUS.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PREHISTORIC_TEX_BANK.tex.fla"]
    }],

    ["1e", {
        landscape: "30.FF1Aln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "FORTRESS_SHARED.obj.fla", "FORTRESS_L1A.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "FORTRESS_TEX_BANK.tex.fla"],
        weather: fortress_rain
    }],
    ["1f", {
        landscape: "31.FF2Aln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "FORTRESS_SHARED.obj.fla", "FORTRESS_L2A.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "FORTRESS_TEX_BANK.tex.fla"]
    }],
    ["20", {
        landscape: "32.FF3Bln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "FORTRESS_SHARED.obj.fla", "FORTRESS_L3B.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "FORTRESS_TEX_BANK.tex.fla"],
        weather: fortress_rain
    }],
    ["21", {
        landscape: "33.FFBOSS.n64.lev",
        object_banks: ["GENERIC.obj.fla", "FORTRESS_SHARED.obj.fla", "FORTRESS_BOSS.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "FORTRESS_TEX_BANK.tex.fla"]
    }],
    ["22", {
        landscape: "34.FFBONUS.n64.lev",
        object_banks: ["GENERIC.obj.fla", "FORTRESS_SHARED.obj.fla", "FORTRESS_BONUS.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "FORTRESS_TEX_BANK.tex.fla"]
    }],

    ["23", {
        landscape: "35.OW2Aln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "OOTW_SHARED.obj.fla", "OOTW_L2A.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "OOTW_TEX_BANK.tex.fla"]
    }],
    ["24", {
        landscape: "36.OW2Bln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "OOTW_SHARED.obj.fla", "OOTW_L2B.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "OOTW_TEX_BANK.tex.fla"]
    }],
    ["25", {
        landscape: "37.OW3lnd.n64.lev",
        object_banks: ["GENERIC.obj.fla", "OOTW_SHARED.obj.fla", "OOTW_L3.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "OOTW_TEX_BANK.tex.fla"]
    }],
    ["26", {
        landscape: "38.OWBOSS1.n64.lev",
        object_banks: ["GENERIC.obj.fla", "OOTW_SHARED.obj.fla", "OOTW_BOSS1.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "OOTW_TEX_BANK.tex.fla"]
    }],
    ["27", {
        landscape: "39.TWEENl.n64.lev",
        object_banks: ["GENERIC.obj.fla", "OOTW_SHARED.obj.fla", "TWEEN.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "OOTW_TEX_BANK.tex.fla"]
    }],
    ["28", {
        landscape: "40.OWBOSS3.n64.lev",
        object_banks: ["GENERIC.obj.fla", "OOTW_SHARED.obj.fla", "OOTW_BOSS1.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "OOTW_TEX_BANK.tex.fla"]
    }],
    ["29", {
        landscape: "41.OWBONUS.n64.lev",
        object_banks: ["GENERIC.obj.fla", "OOTW_SHARED.obj.fla", "OOTW_BONUS.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "OOTW_TEX_BANK.tex.fla"]
    }],

    ["2c", {
        landscape: "44.FLYTHRU.n64.lev",
        object_banks: ["GENERIC.obj.fla", "FLYTHRU.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART8.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "FLYTHRU_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla", "CAMEO_TEX_BANK.tex.fla"]
    }], // "Flythru (title)"
    ["2d", {
        landscape: "45.FLYTHRU.n64.lev",
        object_banks: ["GENERIC.obj.fla", "FLYTHRU.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART8.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "FLYTHRU_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla", "CAMEO_TEX_BANK.tex.fla"]
    }], // "Flythru (credits)"
    ["2e", {
        landscape: "46.INTROl.n64.lev",
        object_banks: ["GENERIC.obj.fla", "INTRO.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "CAMEO_TEX_BANK.tex.fla"]
    }], // "Intro cutscene"
    ["2f", {
        landscape: "47.OUTROl.n64.lev",
        object_banks: ["GENERIC.obj.fla", "OUTRO.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "CAMEO_TEX_BANK.tex.fla"]
    }], // "Outro cutscene"

    ["2b", {
        landscape: "43.PRESENT.n64.lev",
        object_banks: ["GENERIC.obj.fla", "PRESENTATION.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PRESENT_TEX_BANK.tex.fla"]
    }], // "Presentation (studio logos)"

    // TODO: compose artificial menu screen scene
]);

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;

        const bankDescriptor = sceneBanks.get(this.id);
        assert(bankDescriptor !== undefined);

        const raw_landscape = await dataFetcher.fetchData(`${pathBase}/${bankDescriptor.landscape}`)!; 
        const raw_object_banks = await Promise.all<ArrayBufferSlice>(bankDescriptor.object_banks.map(
            (filename:string) => {return dataFetcher.fetchData(`${pathBase}/${filename}`)!}))
        const raw_texture_banks = await Promise.all<ArrayBufferSlice>(bankDescriptor.texture_banks.map(
            (filename:string) => {return dataFetcher.fetchData(`${pathBase}/${filename}`)!}))


        const landscape = new GloverLevel(new KaitaiStream(raw_landscape.arrayBuffer));
        const object_banks = raw_object_banks.map(
            (raw) => { return raw == null ? null : new GloverObjbank(new KaitaiStream(decompress(raw).arrayBuffer))})
        const texture_banks = raw_texture_banks.map(
            (raw) => { return raw == null ? null : new GloverTexbank(new KaitaiStream(decompress(raw).arrayBuffer))})

        const textureHolder = new GloverTextureHolder();
        const sceneRenderer = new GloverRenderer(device, textureHolder);
        const cache = sceneRenderer.renderHelper.getCache();

        for (let bank of texture_banks) {
            if (bank) {
                textureHolder.addTextureBank(device, bank);
            }
        }

        if (this.id === '08') {
            // Hard-code fix: force ball textures to crystal in castle cave
            //  newball2.bmp -> cball.bmp
            const crystal_tex = textureHolder.idToTexture.get(0x6EA4636F);
            textureHolder.idToTexture.set(0xB83D6D41, crystal_tex!)
        }

        let loadedObjects = new Map<number, GloverObjbank.ObjectRoot>()
        for (let bank of object_banks) {
            if (bank) {
                for (let entry of bank.directory) {
                    loadedObjects.set(entry.objId, entry.objRoot);
                }
            }
        }

        Shadows.Shadow.initializeRenderer(device, cache, textureHolder);


        let scratchMatrix = mat4.create();
        let currentEnemy: GloverEnemy | null = null;
        let currentActor: GloverActorRenderer | null = null; 
        let currentPlatform: GloverPlatform | null = null; 
        let currentObject: GloverActorRenderer | GloverPlatform | GloverVent | null = null;
        let currentVent: GloverVent | null = null;
        let currentBuzzer: GloverBuzzer | null = null;
        let currentGaribState: number = 0;

        function loadActor(id : number) : GloverActorRenderer {
            const objRoot = loadedObjects.get(id);
            if (objRoot === undefined) {
                throw `Object 0x${id.toString(16)} is not loaded!`;
            }
            let new_actor = new GloverActorRenderer(device, cache, textureHolder, objRoot, sceneRenderer.sceneLights);
            return new_actor;
        }

        let skyboxClearColor = [0,0,0];

        let buzzerConnections: [GloverBuzzer, number, number][] = [];
        let ventParents: [GloverVent, number][] = [];
        let shadowCasters: [Shadows.ShadowCaster, boolean][] = [];
        let ballActors: GloverActorRenderer[] = [];
        let enemies: GloverEnemy[] = [];

        // Do a first pass to set up scene lights
        for (let cmd of landscape.body) {
            if (cmd.params === undefined) {
                continue;
            }
            switch (cmd.params.__type) {
                case 'FogConfiguration': {
                    skyboxClearColor = [cmd.params.r/255, cmd.params.g/255, cmd.params.b/255];
                    break;
                }
                case 'AmbientLight': {
                    sceneRenderer.sceneLights.ambientColor[0] = cmd.params.r/255;
                    sceneRenderer.sceneLights.ambientColor[1] = cmd.params.g/255;
                    sceneRenderer.sceneLights.ambientColor[2] = cmd.params.b/255;
                    break;
                }
                case 'DiffuseLight': {
                    // TODO: dbl check this doesn't depend on camera position
                    // TODO: figure out wtf the engine does with those angles
                    sceneRenderer.sceneLights.diffuseColor.push([
                        cmd.params.r/255,
                        cmd.params.g/255,
                        cmd.params.b/255
                    ]);
                    const direction = vec3.fromValues(0, 0, 127);
                    vec3.rotateX(direction, direction, [0,0,0], cmd.params.thetaX);
                    vec3.rotateY(direction, direction, [0,0,0], cmd.params.thetaY);
                    vec3.normalize(direction, direction);
                    sceneRenderer.sceneLights.diffuseDirection.push(direction);
                    break;
                }
            }
        }

        // Now load the actual level
        for (let cmd of landscape.body) {
            if (cmd.params === undefined) {
                continue;
            }
            switch (cmd.params.__type) {
                case 'Water': {
                    currentActor = loadActor(cmd.params.objectId);
                    sceneRenderer.actors.push(currentActor)
                    currentObject = currentActor;
                    mat4.fromTranslation(currentActor.modelMatrix, [cmd.params.x, cmd.params.y, cmd.params.z]);
                    currentActor.setRenderMode(0x20, 0x20);
                    const volume = new GloverWaterVolume(
                        device, cache, textureHolder,
                        [cmd.params.left, cmd.params.top, cmd.params.front],
                        [cmd.params.width, cmd.params.bottom, cmd.params.depth],
                        cmd.params.surfaceY
                    )
                    sceneRenderer.waterVolumes.push(volume);
                    sceneRenderer.miscRenderers.push(volume);
                    break;
                }
                case 'LandActor':
                case 'AnimatedBackgroundActor':
                case 'BackgroundActor': {
                    currentActor = loadActor(cmd.params.objectId);
                    sceneRenderer.actors.push(currentActor)
                    currentObject = currentActor;
                    mat4.fromTranslation(currentActor.modelMatrix, [cmd.params.x, cmd.params.y, cmd.params.z]);
                    if (cmd.params.__type === 'AnimatedBackgroundActor') {
                        const startPaused = this.id === '2e' || this.id === '2f' || this.id === '12';
                        currentActor.playSkeletalAnimation(0, !startPaused, false, 1.0);
                    }
                    break;
                }
                case 'SetActorRotation': {
                    if (currentActor === null) {
                        throw `No active actor for ${cmd.params.__type}!`;
                    }
                    // TODO: confirm rotation order
                    //       using both the water vents in pirates 1 and the flags at the exit of fortress 3
                    mat4.fromZRotation(scratchMatrix, cmd.params.z);
                    mat4.mul(currentActor.modelMatrix, currentActor.modelMatrix, scratchMatrix);
                    mat4.fromYRotation(scratchMatrix, cmd.params.y);
                    mat4.mul(currentActor.modelMatrix, currentActor.modelMatrix, scratchMatrix);
                    mat4.fromXRotation(scratchMatrix, cmd.params.x);
                    mat4.mul(currentActor.modelMatrix, currentActor.modelMatrix, scratchMatrix);
                    break;
                }
                case 'SetActorScale': {
                    if (currentActor === null) {
                        throw `No active actor for ${cmd.params.__type}!`;
                    }
                    // X and Z are swapped, as per Carnival 1 slot machine
                    mat4.scale(currentActor.modelMatrix, currentActor.modelMatrix, [cmd.params.z, cmd.params.y, cmd.params.x]);
                    break;
                }
                case 'SetObjectSparkle': {
                    let sparkleActor: GloverActorRenderer | null = null;
                    if (currentObject instanceof GloverPlatform) {
                        if (currentObject.actor !== null) {
                            sparkleActor = currentObject.actor;
                        }
                    } else if (currentObject instanceof GloverActorRenderer){
                        sparkleActor = currentObject;
                    }
                    if (sparkleActor !== null) {
                        sceneRenderer.miscRenderers.push(new MeshSparkle(
                            device, cache, textureHolder, sparkleActor, cmd.params.period, sceneRenderer.waterVolumes));
                    }
                    break;
                }
                case 'Wind': {
                    const wind = new GloverWind(device, cache, textureHolder, sceneRenderer.waterVolumes,
                        [cmd.params.left, cmd.params.top, cmd.params.front],
                        [cmd.params.width, cmd.params.height, cmd.params.depth],
                        [cmd.params.velX, cmd.params.velY, cmd.params.velZ],
                        cmd.params.turbulence);
                    sceneRenderer.miscRenderers.push(wind);
                    if (cmd.params.active === 0) {
                        wind.visible = false;
                    }
                    break;
                }
                case 'Buzzer': {
                    currentBuzzer = new GloverBuzzer(device, cache, textureHolder,
                        cmd.params.drawThickness, cmd.params.drawDiameter, cmd.params.drawFlags,
                        colorNewFromRGBA(cmd.params.r / 0xFF, cmd.params.g / 0xFF, cmd.params.b / 0xFF, 1),
                        cmd.params.colorJitter / 0xFF);
                    currentBuzzer.reposition(
                        vec3.fromValues(cmd.params.end1X, cmd.params.end1Y, cmd.params.end1Z),
                        vec3.fromValues(cmd.params.end2X, cmd.params.end2Y, cmd.params.end2Z));
                    if (cmd.params.drawFlags & 0x20) {
                        // "Starts inactive" flag
                        currentBuzzer.active = false;
                    }
                    buzzerConnections.push([currentBuzzer, cmd.params.platform1Tag, cmd.params.platform2Tag]);
                    sceneRenderer.miscRenderers.push(currentBuzzer);
                    break;
                }
                case 'BuzzerDutyCycle': {
                    if (currentBuzzer === null) {
                        throw `No active buzzer for ${cmd.params.__type}!`;
                    }
                    currentBuzzer.pushDutyCycle(cmd.params.framesOff, cmd.params.framesOn);
                    break;
                }
                case 'BallSpawnPoint': {
                    const ballActor = loadActor(0x8E4DDE49); // gball.ndo
                    sceneRenderer.actors.push(ballActor)
                    mat4.fromTranslation(ballActor.modelMatrix, [cmd.params.x, cmd.params.y, cmd.params.z]);
                    mat4.scale(ballActor.modelMatrix, ballActor.modelMatrix, [0.05, 0.05, 0.05]);
                    if (cmd.params.type != 1) {
                        ballActor.shadowSize = 5;
                        shadowCasters.push([ballActor, false]);
                        ballActors.push(ballActor);
                    }
                    break;
                }
                case 'Enemy': {
                    let pos = vec3.fromValues(cmd.params.x, cmd.params.y, cmd.params.z)
                    currentEnemy = new GloverEnemy(device, cache, textureHolder, loadedObjects, sceneRenderer.sceneLights, cmd.params.type as number, pos, cmd.params.yRotation, this.id);
                    sceneRenderer.miscRenderers.push(currentEnemy);
                    enemies.push(currentEnemy);
                    break;
                }
                case 'EnemyNormalInstruction': {
                    if (currentEnemy === null) {
                        throw `No active enemy for ${cmd.params.__type}!`;
                    }
                    currentEnemy.pushNormalInstruction(cmd.params.instr);
                    break;
                }
                case 'Vent': {
                    currentVent = new GloverVent(
                        device, cache, textureHolder, loadedObjects, sceneRenderer.sceneLights,
                        [cmd.params.originX, cmd.params.originY, cmd.params.originZ],
                        [cmd.params.particleVelocityX, cmd.params.particleVelocityY, cmd.params.particleVelocityZ],
                        cmd.params.type,
                        null,
                        sceneRenderer.waterVolumes);
                    if (cmd.params.parentTag != 0) {
                        ventParents.push([currentVent, cmd.params.parentTag]);
                    }
                    currentObject = currentVent;
                    sceneRenderer.miscRenderers.push(currentVent);
                    break;
                }
                case 'VentDutyCycle': {
                    if (currentVent === null) {
                        throw `No active vent for ${cmd.params.__type}!`;
                    }
                    currentVent.pushDutyCycle(cmd.params.framesOff, cmd.params.framesOn);
                    break;
                }
                case 'Platform': {
                    currentPlatform = new GloverPlatform(loadActor(cmd.params.objectId));
                    sceneRenderer.actors.push(currentPlatform.actor!)

                    currentObject = currentPlatform;
                    if (cmd.params.objectId == 0x7FDADB91) {
                        // special case exitpost.ndo
                        currentPlatform.setScale(1.5, 2.0, 1.5);
                        currentPlatform.actor!.playSkeletalAnimation(0, true, false);
                    }

                    sceneRenderer.platforms.push(currentPlatform)
                    break;
                }
                case 'NullPlatform': {
                    currentPlatform = new GloverPlatform(null);
                    currentObject = currentPlatform;
                    sceneRenderer.platforms.push(currentPlatform);
                    break;
                }
                case 'PlatSetInitialPos': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    currentPlatform.setPosition(cmd.params.x, cmd.params.y, cmd.params.z);
                    break;
                }
                case 'PlatConstantSpin': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    currentPlatform.setConstantSpin(cmd.params.axis, cmd.params.initialTheta, cmd.params.speed);
                    break;
                }
                case 'PlatSpinFlip': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    currentPlatform.setSpinFlip(cmd.params.theta, cmd.params.cooldownTimer);
                    break;
                }
                case 'PlatRocking': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    currentPlatform.setRocking(cmd.params.axis, cmd.params.theta, cmd.params.deceleration);
                    if (cmd.params.blurHeight > 0) {
                        if (currentPlatform.actor === null) {
                            throw `No actor for ${cmd.params.__type}!`;
                        }
                        const blur = new GloverBlurRenderer(device, cache, textureHolder);
                        currentPlatform.setBlur(blur, cmd.params.blurHeight);
                        sceneRenderer.miscRenderers.push(blur);
                    }
                    for (let i = 0; i < cmd.params.frameAdvance; i++) {
                        currentPlatform.advanceRocking(SRC_FRAME_TO_MS);
                    }
                    break;
                }
                case 'PlatOrbitAroundPoint': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    currentPlatform.setOrbitAroundPoint(cmd.params.axis, [cmd.params.x, cmd.params.y, cmd.params.z], cmd.params.speed);
                    break;
                }
                case 'PlatOrbitPause': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    currentPlatform.setOrbitPause(cmd.params.numFrames, cmd.params.numPauses);
                    break;
                }
                case 'PlatScale': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    currentPlatform.setScale(cmd.params.x, cmd.params.y, cmd.params.z);
                    break;
                }
                case 'PlatPathPoint': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    const duration = (cmd.params.duration == 0) ? 1 : cmd.params.duration;
                    currentPlatform.pushPathPoint(new PlatformPathPoint(
                        vec3.fromValues(cmd.params.x, cmd.params.y, cmd.params.z), duration))
                    break;
                }
                case 'PlatPathAcceleration': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    currentPlatform.pathAccel = cmd.params.acceleration;
                    break;
                }
                case 'PlatMaxVelocity': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    currentPlatform.pathMaxVel = cmd.params.velocity;
                    break;
                }
                case 'PlatSetParent': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    const parent = sceneRenderer.platformByTag.get(cmd.params.tag);
                    if (parent === null) {
                        throw `No parent tagged ${cmd.params.tag}!`;   
                    }
                    currentPlatform.parent = parent;
                    break;
                }
                case 'PlatSetTag': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    sceneRenderer.platformByTag.set(cmd.params.tag, currentPlatform);
                    break;
                }
                case 'PlatCheckpoint': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    currentPlatform.shadowSize = new Shadows.ConstantShadowSize(20); // From engine
                    shadowCasters.push([currentPlatform, false]);
                    break;
                }
                case 'PlatVentAdvanceFrames': {
                    if (currentObject instanceof GloverPlatform) {
                        for (let i = 0; i < cmd.params.numFrames / CONVERT_FRAMERATE; i++) {
                            currentObject.advanceFrame(SRC_FRAME_TO_MS);
                        }
                    } else if (currentObject instanceof GloverVent) {
                        currentObject.advanceDutyCycle(cmd.params.numFrames);
                    } else {                        
                        throw `No active object for ${cmd.params.__type}!`;
                    }
                    break;
                }
                case 'PlatActorEnableWaterAnimation': {
                    if (currentObject instanceof GloverPlatform) {
                        if (currentObject.actor !== null) {
                            currentObject.actor.setRenderMode(0x20, 0x20);
                        }
                    } else if (currentObject instanceof GloverActorRenderer){
                        currentObject.setRenderMode(0x20, 0x20);
                    }
                    break;
                }
                case 'PlatCopySpinFromParent': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    currentPlatform.copySpinFromParent = true;
                    break;
                }
                case 'PlatformConveyor': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    currentPlatform.setConveyor(vec3.fromValues(cmd.params.velX, cmd.params.velY, cmd.params.velZ));
                    break;
                }
                case 'SetExit': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    if (cmd.params.type == 1 || cmd.params.type == 3 || this.id == "09") {
                        const emitter = currentPlatform.initExitSparkle();
                        sceneRenderer.miscRenderers.push(emitter);
                    }
                    if (!cmd.params.visible) {
                        if (currentPlatform.actor !== null) {
                            currentPlatform.actor.visible = false;
                        }
                    }
                    break;
                }
                case 'GaribGroup': {
                    currentGaribState = cmd.params.initialState;
                    break;
                }
                case 'Garib': {
                    const flipbookMetadata = collectibleFlipbooks[cmd.params.type];
                    if (flipbookMetadata === undefined) {
                        throw `Unrecognized collectible type!`;
                    }
                    const flipbook = new GloverFlipbookRenderer(device, cache, textureHolder, flipbookMetadata)
                    flipbook.isGarib = cmd.params.type == 0;
                    const pos = vec3.fromValues(cmd.params.x, cmd.params.y, cmd.params.z);
                    mat4.fromTranslation(flipbook.drawMatrix, pos);
                    sceneRenderer.flipbooks.push(flipbook);
                    shadowCasters.push([flipbook, cmd.params.dynamicShadow !== 0]);
                    flipbook.visible = (currentGaribState !== 0);
                    if (cmd.params.type == 2) {
                        // Extra lives are sparkly
                        const emitter = new CollectibleSparkle(device, cache, textureHolder, pos, CollectibleSparkleType.ExtraLife);
                        sceneRenderer.miscRenderers.push(emitter);
                        emitter.visible = (currentGaribState !== 0);
                    }
                    break;
                }
                case 'Powerup': {
                    if (cmd.params.type != 7 && cmd.params.type != 9) {
                        const actor = loadActor(powerup_objects[cmd.params.type]);
                        sceneRenderer.actors.push(actor)
                        const pos = vec3.fromValues(cmd.params.x, cmd.params.y, cmd.params.z);
                        mat4.fromRotationTranslationScale(actor.modelMatrix,
                            identityRotation,
                            pos,
                            [0.4, 0.4, 0.4]);
                        actor.shadowSize = 10;
                        actor.playSkeletalAnimation(0, true, false);
                        shadowCasters.push([actor, false]);
                        sceneRenderer.miscRenderers.push(new CollectibleSparkle(device, cache, textureHolder, pos, CollectibleSparkleType.Powerup));
                    }
                    break;
                }
                case 'MrTip': {
                    let tip = new GloverMrTip(
                        device, cache, textureHolder,
                        vec3.fromValues(cmd.params.x, cmd.params.y, cmd.params.z));
                    sceneRenderer.mrtips.push(tip);
                    shadowCasters.push([tip, false]);
                    break;
                }
                case 'Backdrop': {
                    assert(cmd.params.decalPosX === 0 && cmd.params.decalPosY === 0);
                    assert(cmd.params.decalParentIdx === 0);
                    assert(cmd.params.scrollSpeedX > 0);
                    // TODO: implement alternative primitive colors for hub world
                    const backdrops = sceneRenderer.backdrops;
                    let idx = 0;
                    for (; idx < backdrops.length; idx++) {
                        if (backdrops[idx].backdropSortKey < cmd.params.sortKey) {
                            break;
                        } else if (backdrops[idx].textureId === cmd.params.textureId && backdrops[idx].backdropSortKey === cmd.params.sortKey) {
                            break;
                        }
                    }
                    if (bankDescriptor.backdrop_primitive_color === undefined) {
                        bankDescriptor.backdrop_primitive_color = [0xFF, 0xFF, 0xFF, 0xFF];
                    }
                    sceneRenderer.backdrops.splice(idx, 0, new GloverBackdropRenderer(device, cache, textureHolder, cmd.params, bankDescriptor.backdrop_primitive_color));
                    break;
                }
            }
        }

        for (let platform of sceneRenderer.platforms) {
            platform.updateModelMatrix();
        }

        for (let [vent, tag] of ventParents) {
            assert(sceneRenderer.platformByTag.has(tag));
            vent.setParent(sceneRenderer.platformByTag.get(tag)!);
        }

        for (let connection of buzzerConnections) {
            if (connection[1] !== 0) {
                assert(sceneRenderer.platformByTag.has(connection[1]));
                connection[0].reposition(sceneRenderer.platformByTag.get(connection[1])!, null);
            }
            if (connection[2] !== 0) {
                assert(sceneRenderer.platformByTag.has(connection[2]));
                connection[0].reposition(null, sceneRenderer.platformByTag.get(connection[2])!);
            }

        }

        if (bankDescriptor.weather !== undefined) {
            sceneRenderer.weather = new GloverWeatherRenderer(device, cache, textureHolder, bankDescriptor.weather);
        }

        const shadowTerrain = sceneRenderer.actors; // TODO: figure out actual list

        // Reproject ball onto closest surface
        for (let ballActor of ballActors) {
            // TODO: get radius from mesh itself:
            const radius = 10;
            const ballPos = ballActor.getPosition();
            ballPos[1] += radius;
            let collision = Shadows.projectOntoTerrain(ballPos, ballActor, shadowTerrain);
            if (collision != null) {
                const dist = collision.position[1] - (ballPos[1] - 2*radius);
                ballActor.modelMatrix[13] += dist;
            }
        }

        for (let enemy of enemies) {
            enemy.terrain = shadowTerrain;
        }

        // Project shadows
        // TODO: not onto no-clip objects
        for (let [shadowCaster, dynamic] of shadowCasters) {
            const shadow = new Shadows.Shadow(shadowCaster, shadowTerrain, dynamic);
            sceneRenderer.shadows.push(shadow);
            shadow.visible = shadowCaster.visible;
        }

        // Hard-coded fix for the stamp vents in Out Of This World 2, because
        // our path movement code isn't frame-accurate so otherwise things get
        // out of sync
        if (this.id === '24') {
            for (let [vent, tag] of ventParents) {
                const plat: GloverPlatform = sceneRenderer.platformByTag.get(tag)!;
                if (tag === 138) {
                    plat.pushPathCallback((plat: GloverPlatform, pathIdx: number): void => {
                        if (pathIdx === 1) {
                            vent.oneshotRun(11);
                        } else {
                            vent.oneshotRun(1);
                        }
                    });
                } else {
                    plat.pushPathCallback((plat: GloverPlatform, pathIdx: number): void => {
                        if (pathIdx === 0) {
                            vent.oneshotRun(11);
                        }
                    });
                }
                vent.clearDutyCycle();
            }
        }

        // Hard-coded behavior for robot limbs in various
        // OOTW boss stages
        const linkages: [number, number, vec3][] = []
        if (this.id === '26') {
            linkages.push(
                [1, hashStr("bot_foot_L"), vec3.fromValues(-50,0,170)],
                [2, hashStr("bot_foot_R"), vec3.fromValues(170,0,-50)],
            )
        } else if (this.id === '28') {
            linkages.push(
                [1, hashStr("roblsho"), vec3.fromValues(0,0,0)],
                [2, hashStr("robrsho"), vec3.fromValues(0,0,0)],
                [4, hashStr("roblgun"), vec3.fromValues(0,0,0)],
                [5, hashStr("robrgun"), vec3.fromValues(0,0,0)],
            )
        }
        if (linkages.length > 0) {
            const boss = enemies[0];
            boss.actor.updateDrawMatrices();
            for (let [tag, mesh_id, offset] of linkages) {
                let transformMatrix: mat4 | null = null;
                boss.actor.rootMesh.forEachMesh((node: ActorMeshNode) => {
                    if (node.mesh.id === mesh_id) {
                        transformMatrix = node.drawMatrix;
                    }
                })                
                const plat = sceneRenderer.platformByTag.get(tag)!;
                plat.setPosition(offset[0],offset[1],offset[2]);
                plat.setScale(1,1,1);
                plat.linkedTransform = transformMatrix;
                plat.updateModelMatrix();
            }                
        }

        sceneRenderer.renderPassDescriptor = makeAttachmentClearDescriptor(
            colorNewFromRGBA(skyboxClearColor[0], skyboxClearColor[1], skyboxClearColor[2]));

        return sceneRenderer;
    }
}

// Names taken from landscape file metadata
const id = `gv`;
const name = "Glover";

const sceneDescs = [
    "Hub world",
    new SceneDesc(`00`, "Hub 1"),
    new SceneDesc(`01`, "Hub 2"),
    new SceneDesc(`02`, "Hub 3"),
    new SceneDesc(`03`, "Hub 4"),
    new SceneDesc(`04`, "Hub 5"),
    new SceneDesc(`05`, "Hub 6"),
    new SceneDesc(`06`, "Hub 7"),
    new SceneDesc(`07`, "Hub 8"),
    new SceneDesc(`08`, "Castle Cave"),
    new SceneDesc(`09`, "Assault Course"),
    new SceneDesc(`2a`, "Wayroom"),

    "Atlantis",
    new SceneDesc(`0a`, "Atlantis Level 1"),
    new SceneDesc(`0b`, "Atlantis Level 2"),
    new SceneDesc(`0c`, "Atlantis Level 3"),
    new SceneDesc(`0d`, "Atlantis Boss"),
    new SceneDesc(`0e`, "Atlantis Bonus"),

    "Carnival",
    new SceneDesc(`0f`, "Carnival Level 1"),
    new SceneDesc(`10`, "Carnival Level 2"),
    new SceneDesc(`11`, "Carnival Level 3"),
    new SceneDesc(`12`, "Carnival Boss"),
    new SceneDesc(`13`, "Carnival Bonus"),

    "Pirate's Cove",
    new SceneDesc(`14`, "Pirate's Cove Level 1"),
    new SceneDesc(`15`, "Pirate's Cove Level 2"),
    new SceneDesc(`16`, "Pirate's Cove Level 3"),
    new SceneDesc(`17`, "Pirate's Cove Boss"),
    new SceneDesc(`18`, "Pirate's Cove Bonus"),

    "Prehistoric",
    new SceneDesc(`19`, "Prehistoric Level 1"),
    new SceneDesc(`1a`, "Prehistoric Level 2"),
    new SceneDesc(`1b`, "Prehistoric Level 3"),
    new SceneDesc(`1c`, "Prehistoric Boss"),
    new SceneDesc(`1d`, "Prehistoric Bonus"),

    "Fortress of Fear",
    new SceneDesc(`1e`, "Fortress of Fear Level 1"),
    new SceneDesc(`1f`, "Fortress of Fear Level 2"),
    new SceneDesc(`20`, "Fortress of Fear Level 3"),
    new SceneDesc(`21`, "Fortress of Fear Boss"),
    new SceneDesc(`22`, "Fortress of Fear Bonus"),

    "Out Of This World",
    new SceneDesc(`23`, "Out Of This World Level 1"),
    new SceneDesc(`24`, "Out Of This World Level 2"),
    new SceneDesc(`25`, "Out Of This World Level 3"),
    new SceneDesc(`26`, "Out Of This World Boss (phase 1)"),
    new SceneDesc(`27`, "Out Of This World Boss (phase 2)"),
    new SceneDesc(`28`, "Out Of This World Boss (phase 3)"),
    new SceneDesc(`29`, "Out Of This World Bonus"),

    "System",
    new SceneDesc(`2c`, "Flythru (title)"),
    new SceneDesc(`2d`, "Flythru (credits)"),
    new SceneDesc(`2e`, "Intro cutscene"),
    new SceneDesc(`2f`, "Outro cutscene"),
    new SceneDesc(`2b`, "Presentation (studio logos)"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
