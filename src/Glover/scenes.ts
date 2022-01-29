
import * as Viewer from '../viewer';
import * as UI from '../ui';
import * as BYML from '../byml';

import * as F3DEX from '../BanjoKazooie/f3dex';


import * as Shadows from './shadows';
import { GloverTextureHolder } from './textures';
import { SRC_FRAMERATE, DST_FRAMERATE, SRC_FRAME_TO_MS, DST_FRAME_TO_MS, CONVERT_FRAMERATE } from './timing';


import { GenericRenderable, SceneLighting, GloverActorRenderer, GloverBackdropRenderer, GloverSpriteRenderer, GloverFlipbookRenderer } from './render';

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
import { colorNewFromRGBA } from '../Color';

import { Yellow, colorNewCopy, Magenta, White } from "../Color";
import { drawWorldSpaceLine, drawWorldSpacePoint, drawWorldSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk";

import { CameraController } from '../Camera';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { makeAttachmentClearDescriptor, makeBackbufferDescSimple, standardFullClearRenderPassDescriptor, opaqueBlackFullClearRenderPassDescriptor, pushAntialiasingPostProcessPass } from '../gfx/helpers/RenderGraphHelpers';

import { GloverLevel, GloverObjbank, GloverTexbank } from './parsers';
import { decompress } from './fla2';
import { radianModulo, subtractAngles, axisRotationToQuaternion } from './util';
import { framesets, collectibleFlipbooks, Particle, ParticlePool, particleFlipbooks, particleParameters, spawnExitParticle, MeshSparkle } from './framesets';


import { KaitaiStream } from 'kaitai-struct';

const pathBase = `glover`;

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

class PlatformPathPoint {
    constructor(public pos: vec3, public duration: number) {}

    public toString() {
        return "PathPoint("+this.pos+","+this.duration+")";
    }
}

export class GloverPlatform implements Shadows.ShadowCaster {

    private scratchQuat = quat.create();
    private scratchMatrix = mat4.create();
    private scratchVec3 = vec3.create();

    public shadow: Shadows.Shadow | null = null;
    public shadowSize: number | Shadows.ConstantShadowSize = 0;

    // Sparkle

    private exitSparkle = false;
    private exitSparkleFrame = false;
    private exitSparkleParticles: ParticlePool;
    private static exitSparkleEmitTheta = 0; // Static across all exits, as per engine

    // Spin

    private spinSpeed = vec3.fromValues(0,0,0);
    private spinEnabled = [false, false, false];
    private rockingDeceleration = 0.0;
    private lastRockingAdvance: number = 0;

    public copySpinFromParent = false;

    // Orbit

    private orbitPt = vec3.fromValues(0,0,0);
    private orbitEnabled = [false, false, false];
    private orbitSpeed = 0.0;

    // General actor state

    private eulers = vec3.fromValues(0,0,0);
    private rotation = quat.create();
    private position = vec3.fromValues(0,0,0);
    private velocity = vec3.fromValues(0,0,0);
    private scale = vec3.fromValues(1,1,1);

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
    // TODO: use time deltas instead of frames for this
    
    private path : PlatformPathPoint[] = [];
    private pathDirection : number = 1;
    private pathTimeLeft : number = 0;
    private pathCurPt : number = 0;
    private pathPaused : boolean = false;
    public pathAccel : number = 0;
    public pathMaxVel : number = NaN;

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
            this.pathTimeLeft = point.duration;
            this.pathPaused = point.duration < 0;
            this.updateActorModelMatrix();
        }
    }

    public setPosition(x: number, y: number, z: number) {
        this.position[0] = x;
        this.position[1] = y;
        this.position[2] = z;
    }

    public getPosition(): vec3 {
        return this.position;
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
        this.spinSpeed[axis] = -speed / SRC_FRAME_TO_MS;
        this.rockingDeceleration = 0.0;
        this.spinEnabled[axis] = true;
    }

    public setRocking(axis: number, max_theta: number, decel_factor: number) {
        this.eulers[axis] = max_theta;
        this.spinSpeed[axis] = 0;
        this.rockingDeceleration = decel_factor;
        this.spinEnabled[axis] = true;
    }

    public setOrbitAroundPoint(axis: number, point: [number, number, number], speed: number) {
        this.orbitEnabled[axis] = true;
        this.orbitSpeed = speed / SRC_FRAME_TO_MS;
        vec3.copy(this.orbitPt, point);
    }

    public advanceRocking(deltaTime: number) {
        if (this.rockingDeceleration > 0) {
            this.lastRockingAdvance += deltaTime;
            for (let axis = 0; axis < 3; axis += 1) {
                if (!this.spinEnabled[axis]) {
                    continue;
                }
                if (this.lastRockingAdvance >= SRC_FRAME_TO_MS) {
                    this.spinSpeed[axis] -= subtractAngles(this.eulers[axis], 0) / this.rockingDeceleration;
                    this.eulers[axis] += this.spinSpeed[axis];
                    this.eulers[axis] = radianModulo(this.eulers[axis]);
                    if (Math.abs(this.spinSpeed[axis]) <= .0005) {
                        this.spinSpeed[axis] = 0.0;
                    }
                }
            }
            if (this.lastRockingAdvance >= SRC_FRAME_TO_MS) {
                this.lastRockingAdvance -= SRC_FRAME_TO_MS;
            }
        }
    }    

    public updateActorModelMatrix() {
        if (this.actor === null) {
            return;
        }

        // // In-game algorithm, rather than quat.fromEuler:
        // quat.identity(this.rotation);
        // quat.mul(this.rotation, axisRotationToQuaternion([0,1,0], this.eulers[1]), this.rotation);
        // quat.mul(this.rotation, axisRotationToQuaternion([0,0,1], Math.PI + this.eulers[0]), this.rotation);
        // quat.mul(this.rotation, axisRotationToQuaternion([1,0,0], this.eulers[2]), this.rotation);
        quat.fromEuler(this.rotation, this.eulers[0] * 180 / Math.PI, this.eulers[1] * 180 / Math.PI, this.eulers[2] * 180 / Math.PI);

        let finalPosition = this.position;
        let finalRotation = this.rotation;
        if (this.parent !== undefined) {
            this.parent.updateActorModelMatrix();

            if (this.copySpinFromParent) {
                finalRotation = this.scratchQuat;
                quat.mul(finalRotation, this.parent.rotation, this.rotation);
            }
            
            finalPosition = this.scratchVec3
            vec3.transformQuat(finalPosition, this.position, this.parent.rotation);
            vec3.add(finalPosition, finalPosition, this.parent.position);
        }
        mat4.fromRotationTranslationScale(this.actor.modelMatrix, finalRotation, finalPosition, this.scale);
    }

    public advanceFrame(deltaTime : number, viewerInput : Viewer.ViewerRenderInput | null = null): void {
        if (deltaTime == 0) {
            return;
        }

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

                    particleVelocity[0] /= SRC_FRAME_TO_MS;
                    particleVelocity[1] /= SRC_FRAME_TO_MS;
                    particleVelocity[2] /= SRC_FRAME_TO_MS;


                    spawnExitParticle(this.exitSparkleParticles, particleOrigin1, particleVelocity, 1.0);

                    particleVelocity[0] *= -1;
                    particleVelocity[2] *= -1;

                    spawnExitParticle(this.exitSparkleParticles, particleOrigin2, particleVelocity, 1.0);
                }
                this.exitSparkleFrame = !this.exitSparkleFrame;
            }
        }

        let curSpeed = vec3.length(this.velocity);

        if (this.path.length > 0 && !this.pathPaused) {
            const dstPt = this.path[this.pathCurPt].pos;
            const journeyVector = this.scratchVec3;
            vec3.sub(journeyVector, dstPt, this.position);
            const distRemaining = vec3.length(journeyVector);
            vec3.normalize(journeyVector, journeyVector);

            // TODO: remove
            // if (viewerInput !== null) {
            //     drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, this.position, '' + this.path, 0, White, { outline: 6 });
            // }

            let effectiveAccel = this.pathAccel;
            const speedCutoff = ((this.pathAccel + curSpeed) * curSpeed) / (2*this.pathAccel);
            if (speedCutoff > distRemaining) {
                // This is more accurate than the active version of this code block,
                // but IMO looks worse:
                // if (curSpeed > distRemaining) {
                //     vec3.scaleAndAdd(this.velocity, this.velocity, journeyVector, -effectiveAccel);
                // }
                vec3.scaleAndAdd(this.velocity, this.velocity, journeyVector, -effectiveAccel);
            } else {
                vec3.scaleAndAdd(this.velocity, this.velocity, journeyVector, effectiveAccel);
            }

            if (!isNaN(this.pathMaxVel) && curSpeed > this.pathMaxVel) {
                const damping = this.pathMaxVel / curSpeed;
                this.velocity[0] *= damping;
                this.velocity[1] *= damping;
                this.velocity[2] *= damping;
            }

            if (this.pathTimeLeft > 0) {
                this.pathTimeLeft -= deltaTime;
            } else {
                if (distRemaining < curSpeed + 0.01) {
                    this.pathCurPt = (this.pathCurPt + this.pathDirection) % this.path.length;
                    this.pathTimeLeft = this.path[this.pathCurPt].duration;
                    this.pathPaused = this.path[this.pathCurPt].duration < 0;
                    vec3.copy(this.position, dstPt);
                    vec3.zero(this.velocity);
                    curSpeed = 0;
                }                
            }
        }

        for (let axis = 0; axis < 3; axis += 1) {
            if (!this.orbitEnabled[axis]) {
                continue;
            }
            // TODO: very very very not right:
            // vec3.sub(this.scratchVec3, this.position, this.orbitPt);
            // const dist = vec3.length(this.scratchVec3);
            // let theta = 0;
            // if (axis == 0) {
            //     theta = Math.atan2(this.scratchVec3[1],this.scratchVec3[2]);
            // } else if (axis == 1) {
            //     theta = Math.atan2(this.scratchVec3[0],this.scratchVec3[2]);
            // } else {
            //     theta = Math.atan2(this.scratchVec3[0],this.scratchVec3[1]);
            // }
            // theta += this.orbitSpeed * deltaTime;
            // const x = Math.cos(theta) * dist;
            // const y = Math.sin(theta) * dist;
            // if (axis == 0) {
            //     this.position[1] = this.orbitPt[1] + x;
            //     this.position[2] = this.orbitPt[2] + y;
            // } else if (axis == 1) {
            //     this.position[0] = this.orbitPt[0] + x;
            //     this.position[2] = this.orbitPt[2] + y;
            // } else {
            //     this.position[0] = this.orbitPt[0] + x;
            //     this.position[1] = this.orbitPt[1] + y;
            // }
        }

        // TODO: add deceleration
        vec3.add(this.position, this.position, this.velocity);

        if (this.rockingDeceleration > 0.0) {
            this.advanceRocking(deltaTime);
        } else {
            this.eulers[0] += this.spinSpeed[0] * deltaTime;
            this.eulers[1] += this.spinSpeed[1] * deltaTime;
            this.eulers[2] += this.spinSpeed[2] * deltaTime;
            this.eulers[0] = radianModulo(this.eulers[0]);
            this.eulers[1] = radianModulo(this.eulers[1]);
            this.eulers[2] = radianModulo(this.eulers[2]);
        }

        this.updateActorModelMatrix()
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

    static private velocity = [0,0,0];

    public visible: boolean = true;

    constructor(device: GfxDevice, cache: GfxRenderCache, textureHolder: GloverTextureHolder, private position: vec3, private type: CollectibleSparkleType) {
        this.particles = new ParticlePool(device, cache, textureHolder, 6);
    }

    public destroy(device: GfxDevice): void {
        this.particles.destroy(device);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
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

        if (!this.visible) {
            return;
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
                    Math.cos(-this.frameCount) / SRC_FRAME_TO_MS,
                    -.5 / SRC_FRAME_TO_MS,
                    Math.sin(-this.frameCount) / SRC_FRAME_TO_MS,
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

    public miscParticleEmitters: GenericRenderable[] = [];
    public mrtips: GloverMrTip[] = [];
    public shadows: Shadows.Shadow[] = [];
    public platforms: GloverPlatform[] = [];
    public platformByTag = new Map<number, GloverPlatform>();

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
        c.setSceneMoveSpeedMult(30/60);
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
            // TODO: make uncheck hide
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
                for (let renderer of this.miscParticleEmitters) {
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
                for (let renderer of this.miscParticleEmitters) {
                    renderer.visible = this.originalVisibility.get(renderer)!;
                }
            }
        };

        renderHacksPanel.contents.appendChild(showHiddenCheckbox.elem);

        const enableDebugInfoCheckbox = new UI.Checkbox('Show debug information', false);
        enableDebugInfoCheckbox.onchanged = () => {
            for (let actor of this.actors) {
                actor.setDebugInfoVisible(enableDebugInfoCheckbox.checked);
            }
        };
        renderHacksPanel.contents.appendChild(enableDebugInfoCheckbox.elem);

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
        for (let renderer of this.miscParticleEmitters) {
            renderer.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
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

        for (let renderer of this.actors) {
            renderer.destroy(device);
        }
        for (let renderer of this.backdrops) {
            renderer.destroy(device);
        }
        for (let renderer of this.flipbooks) {
            renderer.destroy(device);
        }
        for (let renderer of this.miscParticleEmitters) {
            renderer.destroy(device);
        }
        for (let renderer of this.mrtips) {
            renderer.destroy(device);
        }
        this.textureHolder.destroy(device);
    }
}


interface GloverSceneBankDescriptor {
    landscape: string,
    object_banks: string[],
    texture_banks: string[],
    backdrop_primitive_color?: number[]
};

// Level ID to bank information
// TODO: move this into an external ts file
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
        // TODO:
        //      - not loading all crystal textures properly (likely)
        //        has to do with non-indexed textures in dynamic models,
        //        which i was winging -- double check them
        landscape: "08.CAVEln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "CAVE.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"]
    }], //"Castle Cave"),
    ["09", {
        landscape: "09.ACOURSE.n64.lev",
        object_banks: ["GENERIC.obj.fla", "ASSAULT COURSE.obj.fla"],
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
    ["0c", { // TODO: figure out why this is crashing
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
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "CARNIVAL_TEX_BANK.tex.fla"]}],
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
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PREHISTORIC_TEX_BANK.tex.fla"]
    }],
    ["1a", { // TODO: lava should have water animation
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
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PREHISTORIC_TEX_BANK.tex.fla"]
    }],
    ["1d", {
        landscape: "29.PHBONUS.n64.lev",
        object_banks: ["GENERIC.obj.fla", "PREHISTORIC_SHARED.obj.fla", "PREHISTORIC_BONUS.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PREHISTORIC_TEX_BANK.tex.fla"]
    }],

    ["1e", {
        landscape: "30.FF1Aln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "FORTRESS_SHARED.obj.fla", "FORTRESS_L1A.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "FORTRESS_TEX_BANK.tex.fla"]
    }],
    ["1f", {
        landscape: "31.FF2Aln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "FORTRESS_SHARED.obj.fla", "FORTRESS_L2A.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "FORTRESS_TEX_BANK.tex.fla"]
    }],
    ["20", {
        landscape: "32.FF3Bln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "FORTRESS_SHARED.obj.fla", "FORTRESS_L3B.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "FORTRESS_TEX_BANK.tex.fla"]
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
        object_banks: ["GENERIC.obj.fla", "FLYTHRU.obj.fla", "HUB_PART7.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "FLYTHRU_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"]
    }], // "Flythru (title)"
    ["2d", {
        landscape: "45.FLYTHRU.n64.lev",
        object_banks: ["GENERIC.obj.fla", "FLYTHRU.obj.fla", "HUB_PART7.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "FLYTHRU_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"]
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

        const raw_landscape = await dataFetcher.fetchData(`${pathBase}/${bankDescriptor.landscape}?cache_bust=2`)!; 
        const raw_object_banks = await Promise.all<ArrayBufferSlice>(bankDescriptor.object_banks.map(
            (filename:string) => return dataFetcher.fetchData(`${pathBase}/${filename}?cache_bust=2`)!))
        const raw_texture_banks = await Promise.all<ArrayBufferSlice>(bankDescriptor.texture_banks.map(
            (filename:string) => return dataFetcher.fetchData(`${pathBase}/${filename}?cache_bust=2`)!))


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
        let currentActor: GloverActorRenderer | null = null; 
        let currentPlatform: GloverPlatform | null = null; 
        let currentObject: GloverActorRenderer | GloverPlatform | null = null;
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

        let shadowCasters: Shadows.ShadowCaster[] = [];

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
                    break;
                }
                case 'LandActor':
                case 'BackgroundActor0xbc':
                case 'BackgroundActor0x91': {
                    currentActor = loadActor(cmd.params.objectId);
                    sceneRenderer.actors.push(currentActor)
                    currentObject = currentActor;
                    mat4.fromTranslation(currentActor.modelMatrix, [cmd.params.x, cmd.params.y, cmd.params.z]);
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
                    mat4.scale(currentActor.modelMatrix, currentActor.modelMatrix, [cmd.params.x, cmd.params.y, cmd.params.z]);
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
                        sceneRenderer.miscParticleEmitters.push(new MeshSparkle(
                            device, cache, textureHolder, sparkleActor, cmd.params.period));
                    }
                    break;
                }
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
                case 'PlatRocking': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    currentPlatform.setRocking(cmd.params.axis, cmd.params.theta, cmd.params.deceleration);
                    // TODO: blur
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
                    const duration = (cmd.params.duration == 0) ? SRC_FRAME_TO_MS : cmd.params.duration * SRC_FRAME_TO_MS;
                    currentPlatform.pushPathPoint(new PlatformPathPoint(
                        vec3.fromValues(cmd.params.x, cmd.params.y, cmd.params.z), duration))
                    break;
                }
                case 'PlatPathAcceleration': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    currentPlatform.pathAccel = cmd.params.acceleration * CONVERT_FRAMERATE;
                    break;
                }
                case 'PlatMaxVelocity': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    currentPlatform.pathMaxVel = cmd.params.velocity * CONVERT_FRAMERATE;
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
                    shadowCasters.push(currentPlatform);
                    break;
                }
                case 'PlatVentAdvanceFrames': {
                    // TODO: support vent objects, too
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    for (let i = 0; i < cmd.params.numFrames / CONVERT_FRAMERATE; i++) {
                        currentPlatform.advanceFrame(SRC_FRAME_TO_MS);
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
                        sceneRenderer.miscParticleEmitters.push(emitter);
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
                    if (!cmd.params.dynamicShadow) {
                        // TODO: handle dynamic shadow flag properly
                        shadowCasters.push(flipbook);
                    }
                    flipbook.visible = (currentGaribState !== 0);
                    if (cmd.params.type == 2) {
                        // Extra lives are sparkly
                        const emitter = new CollectibleSparkle(device, cache, textureHolder, pos, CollectibleSparkleType.ExtraLife);
                        sceneRenderer.miscParticleEmitters.push(emitter);
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
                        shadowCasters.push(actor);
                        sceneRenderer.miscParticleEmitters.push(new CollectibleSparkle(device, cache, textureHolder, pos, CollectibleSparkleType.Powerup));
                    }
                    break;
                }
                case 'MrTip': {
                    let tip = new GloverMrTip(
                        device, cache, textureHolder,
                        vec3.fromValues(cmd.params.x, cmd.params.y, cmd.params.z));
                    sceneRenderer.mrtips.push(tip);
                    shadowCasters.push(tip);
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
                        if (backdrops[idx].sortKey < cmd.params.sortKey) {
                            break;
                        } else if (backdrops[idx].textureId === cmd.params.textureId && backdrops[idx].sortKey === cmd.params.sortKey) {
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
            platform.updateActorModelMatrix();
        }

        const shadowTerrain = sceneRenderer.actors; // TODO: figure out actual list
        for (let shadowCaster of shadowCasters) {
            const shadow = new Shadows.Shadow(shadowCaster, shadowTerrain);
            sceneRenderer.shadows.push(shadow);
            shadow.visible = shadowCaster.visible;
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

    "Atlantis"
    new SceneDesc(`0a`, "Atlantis Level 1"),
    new SceneDesc(`0b`, "Atlantis Level 2"),
    new SceneDesc(`0c`, "Atlantis Level 3"),
    new SceneDesc(`0d`, "Atlantis Boss"),
    new SceneDesc(`0e`, "Atlantis Bonus"),

    "Carnival"
    new SceneDesc(`0f`, "Carnival Level 1"),
    new SceneDesc(`10`, "Carnival Level 2"),
    new SceneDesc(`11`, "Carnival Level 3"),
    new SceneDesc(`12`, "Carnival Boss"),
    new SceneDesc(`13`, "Carnival Bonus"),

    "Pirate's Cove"
    new SceneDesc(`14`, "Pirate's Cove Level 1"),
    new SceneDesc(`15`, "Pirate's Cove Level 2"),
    new SceneDesc(`16`, "Pirate's Cove Level 3"),
    new SceneDesc(`17`, "Pirate's Cove Boss"),
    new SceneDesc(`18`, "Pirate's Cove Bonus"),

    "Prehistoric"
    new SceneDesc(`19`, "Prehistoric Level 1"),
    new SceneDesc(`1a`, "Prehistoric Level 2"),
    new SceneDesc(`1b`, "Prehistoric Level 3"),
    new SceneDesc(`1c`, "Prehistoric Boss"),
    new SceneDesc(`1d`, "Prehistoric Bonus"),

    "Fortress of Fear"
    new SceneDesc(`1e`, "Fortress of Fear Level 1"),
    new SceneDesc(`1f`, "Fortress of Fear Level 2"),
    new SceneDesc(`20`, "Fortress of Fear Level 3"),
    new SceneDesc(`21`, "Fortress of Fear Boss"),
    new SceneDesc(`22`, "Fortress of Fear Bonus"),

    "Out Of This World"
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
