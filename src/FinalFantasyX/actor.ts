import { mat4, ReadonlyMat4, ReadonlyVec3, vec3, vec4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { assert, assertExists, hexzero, nArray } from "../util.js";
import { computeModelMatrixS, getMatrixTranslation, lerp, lerpAngle, MathConstants, normToLength, randomRangeFloat, setMatrixTranslation, transformVec3Mat4w0, transformVec3Mat4w1, Vec3One } from "../MathHelpers.js";
import { ActorResources, angleStep, LevelObjectHolder } from "./script.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { ViewerRenderInput } from "../viewer.js";
import { ActorPartInstance, FFXToNoclip, TextureData } from "./render.js";
import { Emitter, EMITTER_DONE_TIMER, LevelParticles, ParticleData, ParticleSystem, trailArgsScratch } from "./particle.js";
import { GfxDevice, GfxFormat, GfxTexture, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform.js";
import { SkinningMode, Animation, ActorModel } from "./bin.js";

export const enum ActorFlags {
    IGNORE_GROUND = 0x80,
    ALLOW_TURNING = 0x400,
}

const enum RefPointID {
    Head = 1,
    Eyes = 2,
    Center = 6,
    LeftFoot = 7,
    RightFoot = 8,
}

const enum Speed {
    STOPPED,
    WALKING,
    RUNNING,
}

export const enum FloorMode {
    AIR,
    GROUND,
    WATER,
}


const enum ValueType {
    Angle,
    Pos,
    Scale,
}

function animValue(t: number, endT: number, frac: number, prev: number, curve: Int16Array | number | undefined, type: ValueType): number {
    let value = 0;
    if (!curve) {
        if (type === ValueType.Scale)
            value = 0x1000;
    } else if (curve instanceof Int16Array) {
        const from = curve[t | 0];
        const to = curve[endT | 0];
        if (type === ValueType.Angle) {
            value = lerpAngle(from, to, t%1, 0x1000);
        } else
            value = lerp(from, to, t%1);
    } else {
        value = curve;
    }
    assert(!isNaN(value))
    if (type === ValueType.Angle) {
        value *= Math.PI / 0x800;
        return lerpAngle(prev, value, frac);
    }
    else if (type === ValueType.Scale)
        return value / 0x1000;
    return lerp(prev, value, frac);
}

class AnimationState {
    public t = 0;
    public id = -1;
    private animation: Animation | null = null;
    private segment = -1;
    public running = false;
    public isDefault = true;
    public isCustom = false;
    public nextTransition = 0;
    public transitionLeft = 0;
    public defaults = [0, 1, 2];
    public loops = 0;
    public start = -1;
    public end = -1;
    public defaultLoops = -1;
    // the game doesn't properly interpolate the last frame of non-looping animations
    // (interpolation really only happens if a character is slowed)
    // battle animations are played as if they don't loop, so we'll mark them to make sure they do
    public isLoopLike = false;

    constructor (public modelID: number) {}

    public set(obj: LevelObjectHolder, id: number, force = false): void {
        if (this.id === id && this.running && !force)
            return;
        if (this.animation) {
            if (this.nextTransition === 0)
                this.transitionLeft = DEFAULT_TRANSITION_LENGTH;
            else {
                this.transitionLeft = this.nextTransition;
                this.nextTransition = 0;
            }
        }
        this.isCustom = false;
        this.id = id;
        this.resolve(obj.actorResources, id);
        if (this.animation) {
            this.running = true;
            this.isDefault = false;
            this.runAnimationSegment(0);
        }
    }

    private runAnimationSegment(index: number): void {
        this.segment = index;
        const seg = assertExists(this.animation).segments[index];
        this.start = seg.start;
        this.end = seg.end;
        if (this.defaultLoops >= 0)
            this.loops = this.defaultLoops;
        else
            this.loops = seg.loops;
        this.isLoopLike = false;
        this.defaultLoops = -1;
        if (seg.track)
            if (seg.loops !== 1 && seg.end !== seg.track.times[1]) {
                this.end++; // haven't actually seen this
            }
        this.t = seg.start;
    }

    public resolve(resourceMap: Map<number, ActorResources>, animID: number): void {
        const res = resourceMap.get((animID & 0xFFFF0000) >>> 16);
        if (!res) {
            this.animation = null;
            return;
        }
        // check from end, as subsequent loads overwrite earlier ones
        for (let i = res.animations.length-1; i >= 0; i--)
            if (res.animations[i].id === (animID & 0xFFFF)) {
                this.animation = res.animations[i];
                return;
            }
    }

    public finish(): void {
        this.running = false;
        this.isDefault = true;
    }

    public setFromList(obj: LevelObjectHolder, list: number, index: number): void {
        // this represents an action, resolve to an actual ID
        const m = obj.actorResources.get(this.modelID)?.model;
        if (!m) {
            this.animation = null;
            return;
        }
        const id = m.defaultAnimations[list][index];
        if (id === undefined) {
            this.animation = null;
            return;
        }
        this.set(obj, id);
    }

    public update(objects: LevelObjectHolder, dt: number, boneState: Float32Array, boneMappings: Map<number, Uint16Array>, speed: Speed): void {
        if (this.isDefault) {
            const anim = this.defaults[speed];
            if (anim < 0x1000)
                this.setFromList(objects, 0, anim);
            else
                this.set(objects, anim);
            this.isDefault = true;
        }
        if (this.animation && this.running) {
            const segment = this.animation.segments[this.segment];
            const curves = segment.track?.curves;
            if (curves) { // otherwise this is a sleep
                const t = this.t;
                const startFrame = t | 0;
                let endT = startFrame + 1;
                if (endT > this.end - 1) {
                    endT = this.start;
                }
                this.transitionLeft -= dt;
                let transitionFrac = 1;
                if (this.transitionLeft > 0) {
                    transitionFrac = dt / (this.transitionLeft + dt);
                }
                const boneMapping = boneMappings.get(this.id >>> 16);
                for (let i = 0; i < curves.length; i++) {
                    const idx = boneMapping ? boneMapping[i] : i;
                    if (idx === 0xFFFF)
                        continue;
                    boneState[idx*9 + 0] = animValue(t, endT, transitionFrac, boneState[idx*9 + 0], curves[i].eulerX, ValueType.Angle);
                    boneState[idx*9 + 1] = animValue(t, endT, transitionFrac, boneState[idx*9 + 1], curves[i].eulerY, ValueType.Angle);
                    boneState[idx*9 + 2] = animValue(t, endT, transitionFrac, boneState[idx*9 + 2], curves[i].eulerZ, ValueType.Angle);
                    boneState[idx*9 + 3] = animValue(t, endT, transitionFrac, boneState[idx*9 + 3], curves[i].posX, ValueType.Pos);
                    boneState[idx*9 + 4] = animValue(t, endT, transitionFrac, boneState[idx*9 + 4], curves[i].posY, ValueType.Pos);
                    boneState[idx*9 + 5] = animValue(t, endT, transitionFrac, boneState[idx*9 + 5], curves[i].posZ, ValueType.Pos);
                    boneState[idx*9 + 6] = animValue(t, endT, transitionFrac, boneState[idx*9 + 6], curves[i].scaleX, ValueType.Scale);
                    boneState[idx*9 + 7] = animValue(t, endT, transitionFrac, boneState[idx*9 + 7], curves[i].scaleY, ValueType.Scale);
                    boneState[idx*9 + 8] = animValue(t, endT, transitionFrac, boneState[idx*9 + 8], curves[i].scaleZ, ValueType.Scale);
                }
            }

            this.t += dt;
            if (this.end <= this.start + 1 && this.loops === 0) {
                // this is used for freezing some scenery at the end of an animation,
                // relies on step always being 1 for those objects
                this.t = this.start;
            }
            let cutoff = this.isLoopLike || this.loops !== 1 ? this.end : this.end - 1;
            const delta = this.t - cutoff;
            if (delta >= 0) {
                if (this.loops === 1) {
                    this.t = -1; // will get set to something real later
                    this.segment++;
                    // animations started with explicit start and end times never continue to the next segment
                    if (this.isCustom || this.segment >= this.animation.segments.length) {
                        this.running = false;
                        this.isDefault = true;
                    } else {
                        this.runAnimationSegment(this.segment);
                    }
                } else {
                    this.t = this.start + Math.min(delta, 1);
                    if (this.loops > 1)
                        this.loops--;
                }
            }
        }
    }
}

const scratchVec3 = vec3.create();
function invertOrthoMatrix(dst: mat4, src: mat4): void {
    mat4.transpose(dst, src);
    dst[3] = dst[7] = dst[11] = 0; // zero where the translation ended up
    getMatrixTranslation(scratchVec3, src);
    transformVec3Mat4w0(scratchVec3, dst, scratchVec3);
    vec3.scale(scratchVec3, scratchVec3, -1);
    setMatrixTranslation(dst, scratchVec3);
}

const DEFAULT_TRANSITION_LENGTH = 4;
const childScratch = vec3.create();
const boneScratch = vec3.create();
const mtxScratch = mat4.create();
const bones = nArray(10, () => mat4.create());
export class Actor {
    public visible = true;
    public pos = vec3.create();
    public prevPos = vec3.create();
    public offset = vec3.create();
    public scale = 1;
    public mirrorX = false;
    public flags = ActorFlags.ALLOW_TURNING;
    public heading = 0;
    public targetHeading = 0;
    public speed = 0;
    public speedThreshold = 18;
    public hiddenParts = 0;
    public animation: AnimationState;
    public effectLevel = 1;
    private vtxTextures: GfxTexture[] = [];
    private vtxBuffers: Float32Array[] = [];
    private boneState: Float32Array;
    public particles?: ParticleSystem;
    public currTexEffect = -1;
    public groundTri = -1;
    public groundY = 0;
    public groundNormal = vec3.fromValues(0, -1, 0);
    public visitedTris = new Set<number>();
    private textureCopies: GfxTexture[] = [];
    private texEffectState: number[][] = [];
    private bakedShadow = 1;
    public modelMatrix = mat4.create();
    public parent: Actor | null = null;
    public attachPoint = -1;
    public children: Actor[] = [];
    public model: ActorModel | null = null;
    public textures: TextureData[] | null = null;
    public parts: ActorPartInstance[] | null = null;
    public magicManager?: MonsterMagicManager;
    public floorMode = FloorMode.GROUND;
    public shadowRadius = -1;
    public shadowEnabled = true;

    constructor(objects: LevelObjectHolder, public id: number) {
        const res = objects.actorResources.get(id);
        if (res && res.model) {
            this.scale = res.model.scales.actor;
            this.boneState = new Float32Array(res.model.bones.length * 9);
            let idx = 0;
            for (let i = 0; i < res.model.bones.length; i++) {
                this.boneState[idx++] = res.model.bones[i].euler[0];
                this.boneState[idx++] = res.model.bones[i].euler[1];
                this.boneState[idx++] = res.model.bones[i].euler[2];
                this.boneState[idx++] = res.model.bones[i].offset[0] / res.model.scales.offset;
                this.boneState[idx++] = res.model.bones[i].offset[1] / res.model.scales.offset;
                this.boneState[idx++] = res.model.bones[i].offset[2] / res.model.scales.offset;
                this.boneState[idx++] = res.model.bones[i].scale[0];
                this.boneState[idx++] = res.model.bones[i].scale[1];
                this.boneState[idx++] = res.model.bones[i].scale[2];
            }
            if (res.particles) {
                this.particles = new ParticleSystem(this.id, res.particles, res.model.particles?.runner);
                this.particles.active = true;
                this.particles.loop = true;
                if (res.particles.data.magicEntries && res.particles.data.magicProgram) {
                    this.magicManager = new MonsterMagicManager(res.particles.data.magicEntries, res.particles.data.magicProgram, this);
                    this.magicManager.startEffect(4);
                    this.magicManager.startEffect(5);
                    this.magicManager.startEffect(6);
                    this.magicManager.startEffect(7);
                    if (this.id === 0x10AA) {
                        // add a fake emitter to track a position
                        this.particles.emitters.push(new Emitter({
                            pos: vec3.create(),
                            euler: vec3.create(),
                            scale: vec3.create(),
                            delay: 0,
                            behavior: 0,
                            maxDist: 0,
                            width: 0,
                            height: 0,
                            id: 0,
                            g: 0,
                            billboard: 0,
                            eulerOrder: 0,
                        }, res.particles.data))
                    }
                }
            }
            if (res.model.texAnim) {
                this.texEffectState = nArray(res.model.texAnim.patches.length, () => [0, 0]);
            }
            this.model = res.model;
            this.textures = res.textures;
            this.parts = res.parts;
        }
        this.animation = new AnimationState(id);
        // weapons and objects don't cast shadows
        if ((id >>> 0xC) >= 4)
            this.shadowEnabled = false;
    }

    public findGroundTri(objects: LevelObjectHolder): void {
        const oldY = this.pos[1];
        if (this.groundTri >= 0) {
            this.groundTri = objects.findMostRecentTri(this.groundTri, this.pos, this.prevPos);
            this.groundY = this.pos[1];
            this.pos[1] = oldY;
            return;
        }
        this.groundTri = -1;
        this.groundTri = objects.snapToGround(this.pos);
        if (this.groundTri >= 0)
            this.groundY = this.pos[1];
        this.pos[1] = oldY;
    }

    private setChildMatrices(bones: mat4[]): void {
        if (!this.model)
            return;
        for (let i = 0; i < this.children.length; i++) {
            const c = this.children[i];
            const scale = this.model.scales.base;
            vec3.scale(childScratch, Vec3One, 1/scale);
            const pt = this.model.refPoints[c.attachPoint & 0x3FFF];
            if (pt) {
                mat4.scale(c.modelMatrix, bones[pt.bone], childScratch);
                if (pt.pos)
                    vec3.scale(childScratch, pt.pos, scale);
                else
                    vec3.zero(childScratch);
                transformVec3Mat4w1(childScratch, c.modelMatrix, childScratch);
                setMatrixTranslation(c.modelMatrix, childScratch);
            }
            mat4.mul(c.modelMatrix, this.modelMatrix, c.modelMatrix);
        }
    }

    private applySkinning(bones: mat4[]): void {
        if (!this.model)
            return
        for (let i = 0; i < this.model.skinning.length; i++) {
            const s = this.model.skinning[i];
            let buf = this.vtxBuffers[s.part];
            if (!buf) {
                buf = new Float32Array(this.model.parts[s.part].vertexData);
                this.vtxBuffers[s.part] = buf;
            }
            invertOrthoMatrix(mtxScratch, bones[s.relBone]);
            mat4.mul(mtxScratch, mtxScratch, bones[s.bone]);
            for (let j = 0; j < s.lists.length; j++) {
                const sc = s.lists[j];
                for (let k = 0; k < sc.count; k++) {
                    let idx = sc.indexBase;
                    let stride = 4;
                    let scale = 1;
                    if (sc.mode === SkinningMode.BASIC) {
                        idx += sc.data[stride*k + 3];
                    } else if (s.longform) {
                        stride = 5;
                        scale = sc.data[stride*k + 4]/10000;
                        idx += sc.data[stride*k + 3];
                    } else {
                        const extra = sc.data[4*k + 3];
                        idx += ((extra & 0xFF00) >>> 8);
                        scale = (extra & 0xFF)/0xFF;
                    }
                    vec3.set(boneScratch, sc.data[stride*k + 0], sc.data[stride*k + 1], sc.data[stride*k + 2]);
                    transformVec3Mat4w1(boneScratch, mtxScratch, boneScratch);
                    vec3.scale(boneScratch, boneScratch, scale);
                    if (sc.mode === SkinningMode.PERTURB) {
                        buf[4*idx + 0] += boneScratch[0];
                        buf[4*idx + 1] += boneScratch[1];
                        buf[4*idx + 2] += boneScratch[2];
                    } else {
                        buf[4*idx + 0] = boneScratch[0];
                        buf[4*idx + 1] = boneScratch[1];
                        buf[4*idx + 2] = boneScratch[2];
                    }
                }
            }
        }
    }

    public setTextureAnimation(effect: number): void {
        this.currTexEffect = effect;
        for (let i = 0; i < this.texEffectState.length; i++) {
            this.texEffectState[i][0] = 0;
            this.texEffectState[i][1] = 0;
        }
    }

    private updateTextureAnimation(device: GfxDevice, dt: number, effect: number): void {
        if (!this.model || !this.model.texAnim || !this.textures)
            return;
        const texInds = this.model.texAnim.textureIndices;
        for (let i = 0; i < this.texEffectState.length; i++) {
            const p = this.model.texAnim.patches[i];
            const seq = p.sequences.get(effect);
            if (!seq)
                continue;
            let seqIndex = 0;
            const st = this.texEffectState[i];
            if (p.op === 0) { // blinking
                switch (st[0]) {
                    case 0:
                        seqIndex = 0;
                        st[0] = 1;
                        st[1] = randomRangeFloat(60, 150);
                        break;
                    case 1:
                        seqIndex = 0;
                        st[1] -= dt;
                        if (st[1] < 0) {
                            st[0] = 2;
                            st[1] = 0;
                        }
                        break;
                    case 2:
                        seqIndex = 1 + st[1] | 0;
                        st[1] += dt;
                        if (st[1] + 1 >= seq.length) {
                            st[0] = 0;
                        }
                }
            } else if (p.op === 1) { // mouth audio sync?
                seqIndex = 0;
            } else if (p.op === 4) { // animation frames
                const dur = seq[st[0]].duration;
                // negative duration means permanent
                if (dur > 0) {
                    st[1] += dt;
                    if (st[1] > dur) {
                        st[1] -= dur;
                        st[0]++;
                    }
                    if (st[0] === seq.length)
                        st[0] = 0;
                }
                seqIndex = st[0];
            }
            // also op 2, which looks like it should be doing some UV scrolling or something
            // but I don't see where those fields actually get accessed
            const index = seq[seqIndex].index;
            for (let j = 0; j < this.model.texturePairs.length; j++) {
                const pair = this.model.texturePairs[j];
                if (pair.texture === p.target) {
                    device.copySubTexture2D(this.textureCopies[j], p.x, p.y, this.textures[texInds[index][pair.palette]].gfxTexture, 0, 0);
                }
            }
        }
    }

    public render(device: GfxDevice, objects: LevelObjectHolder, dt: number, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (!this.model || !this.parts)
            return;
        if (this.parent) {
            if (this.parent.id !== 1 && (!this.parent.visible || !this.parent.model))
                return;
            this.bakedShadow = this.parent.bakedShadow;
            this.groundTri = this.parent.groundTri;
        } else {
            const checkMap = (this.flags & ActorFlags.IGNORE_GROUND) === 0;
            if (objects.map && checkMap) {
                this.findGroundTri(objects);
                if (this.groundTri >= 0) {
                    this.bakedShadow = objects.triNormAndLight(this.groundNormal, this.groundTri, this.pos);
                }
            }
            // some actors (shop chest in kilika) disable snap to ground as they are OOB,
            // but still snap to an explicit value
            if (this.floorMode === FloorMode.GROUND ||
                this.floorMode === FloorMode.AIR && checkMap && this.pos[1] > this.groundY // not a typo, positive Y is down
            ) {
                this.pos[1] = this.groundY;
            }
        }
        if (this.flags & ActorFlags.ALLOW_TURNING) {
            this.heading = angleStep(this.heading, this.targetHeading, dt * Math.PI/10, 0);
        }

        const totalScale = this.model.scales.base * this.scale / this.model.scales.offset / 100;
        if (!this.parent) {
            mat4.identity(this.modelMatrix);
            this.modelMatrix[0] = totalScale;
            if (this.mirrorX)
                this.modelMatrix[0] *= -1;
            this.modelMatrix[5] = totalScale;
            this.modelMatrix[10] = totalScale;
            mat4.rotateY(this.modelMatrix, this.modelMatrix, -this.heading - MathConstants.TAU/4);
            this.modelMatrix[12] = this.pos[0] + this.offset[0];
            this.modelMatrix[13] = this.pos[1] + this.offset[1];
            this.modelMatrix[14] = this.pos[2] + this.offset[2];
        } else if (this.parent.id === 1 && objects.mapID !== 0xAD) {
            // tidus holding a sphere (not a blitzball)
            const relX = (2*viewerInput.mouseLocation.mouseX / viewerInput.backbufferWidth - 1)/viewerInput.camera.projectionMatrix[0];
            const relY = (2*viewerInput.mouseLocation.mouseY / viewerInput.backbufferHeight - 1)/viewerInput.camera.projectionMatrix[5];
            const depth = 10;
            vec3.set(childScratch, relX*depth, -relY*depth, -depth);
            viewerInput.camera.projectionMatrix
            transformVec3Mat4w1(childScratch, viewerInput.camera.worldMatrix, childScratch);
            transformVec3Mat4w0(childScratch, FFXToNoclip, childScratch);

            computeModelMatrixS(this.modelMatrix, -totalScale, -totalScale, totalScale);
            // scaleMatrix(this.modelMatrix, viewerInput.camera.worldMatrix, totalScale, -totalScale, totalScale);
            mat4.mul(this.modelMatrix, viewerInput.camera.worldMatrix, this.modelMatrix);
            mat4.mul(this.modelMatrix, FFXToNoclip, this.modelMatrix);
            setMatrixTranslation(this.modelMatrix, childScratch);
        }

        while (bones.length < this.model.bones.length)
            bones.push(mat4.create());
        let speed = Speed.STOPPED;
        if (this.speed > this.speedThreshold)
            speed = Speed.RUNNING;
        else if (this.speed > 0)
            speed = Speed.WALKING;
        if (objects.mapID === 0xAD && this.animation.defaults.length > 0x10)
            speed += 0x10; // swimming;
        this.animation.update(objects, dt, this.boneState, this.model.boneMappings, speed);
        // animation keeps going even if hidden
        if (!this.visible || !objects.renderFlags.showObjects)
            return;
        for (let i = 0; i < this.model.bones.length; i++) {
            vec3.set(boneScratch, this.boneState[i*9 + 6], this.boneState[i*9 + 7], this.boneState[i*9 + 8]);
            mat4.fromScaling(bones[i], boneScratch)
            mat4.rotateZ(bones[i], bones[i], this.boneState[i*9 + 2]);
            mat4.rotateY(bones[i], bones[i], this.boneState[i*9 + 1]);
            mat4.rotateX(bones[i], bones[i], this.boneState[i*9 + 0]);
            bones[i][12] = this.boneState[i*9 + 3] * this.model.scales.offset;
            bones[i][13] = this.boneState[i*9 + 4] * this.model.scales.offset;
            bones[i][14] = this.boneState[i*9 + 5] * this.model.scales.offset;
            const parent = this.model.bones[i].parent;
            if (parent >= 0)
                mat4.mul(bones[i], bones[parent], bones[i]);
        }
        this.setChildMatrices(bones);
        this.applySkinning(bones);
        if (this.model.texAnim && this.textures) {
            if (this.textureCopies.length === 0) {
                for (let i = 0; i < this.model.texturePairs.length; i++) {
                    this.textureCopies.push(device.createTexture(
                        makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, this.textures[i].data.width, this.textures[i].data.height, 1)
                    ));
                }
            }
            // restore the base state of the textures
            for (let i = 0; i < this.model.texturePairs.length; i++) {
                device.copySubTexture2D(this.textureCopies[i], 0, 0, this.textures[i].gfxTexture, 0, 0);
            }
            // "default" effects, always active
            this.updateTextureAnimation(device, dt, 1);
            this.updateTextureAnimation(device, dt, 2);
            this.updateTextureAnimation(device, dt, 21);
            // technically multiple can be active
            if (this.currTexEffect >= 0)
                this.updateTextureAnimation(device, dt, this.currTexEffect);
        }
        for (let i = 0; i < this.parts.length; i++) {
            if (this.hiddenParts & (1 << i))
                continue;
            const p = this.parts[i];
            let bone = this.model.parts[i].bone;
            mat4.mul(mtxScratch, this.modelMatrix, bones[bone]);
            if (this.vtxBuffers[i]) {
                const buf = this.vtxBuffers[i];
                if (!this.vtxTextures[i])
                    this.vtxTextures[i] = device.createTexture(makeTextureDescriptor2D(GfxFormat.F32_RGBA, this.model.parts[i].texWidth, 2, 1));
                device.uploadTextureData(this.vtxTextures[i], 0, [buf]);
            }
            p.prepareToRender(renderInstManager, viewerInput, mtxScratch, totalScale, this.model.scales, this.bakedShadow, this.textureCopies, objects.actorsAfterXLU, this.vtxTextures[i]);
        }
        if (this.shadowEnabled) {
            this.refPoint(boneScratch, bones, RefPointID.LeftFoot);
            this.refPoint(childScratch, bones, RefPointID.RightFoot);
            vec3.add(boneScratch, childScratch, boneScratch);
            vec3.scale(boneScratch, boneScratch, .25);
            this.refPoint(childScratch, bones, RefPointID.Head);
            vec3.scaleAndAdd(boneScratch, boneScratch, childScratch, .5);
            boneScratch[1] = this.groundY;
            let radius = this.shadowRadius;
            if (radius < 0)
                radius = (this.id >>> 0xC) === 1 ? this.model.scales.collisionRadius : this.model.scales.shadowRadius;
            objects.shadows.addShadow(viewerInput, boneScratch, this.groundNormal, radius * 1.3);
        }
        if (this.id === 0x106e) { // hide oblitzerator top
            if (this.animation.id === this.model.defaultAnimations[1][0xC0] && !this.animation.running)
                this.hiddenParts = 7;
            if (this.animation.id === this.model.defaultAnimations[1][18])
                this.effectLevel = 1;
            else
                this.effectLevel = 0;
        }
        if (this.magicManager && objects.renderFlags.showParticles) {
            if (this.particles)
                this.particles.data.debug = objects.renderFlags.debugParticles;
            this.magicManager.update(dt, bones, this.particles?.data!, viewerInput, renderInstManager, device);
        }
        if (this.id === 0x10AA) { // end tanker battle
            if (this.animation.id === 0x10aa1019 && !this.animation.running) {
                // this will also trigger a worker that's waiting on a sound effect
                objects.magic[0].reset();
                objects.magic[0].active = true;
            }
            // reference position for the flames
            const e = assertExists(this.particles).emitters;
            const p = e[e.length - 1].pos;
            getMatrixTranslation(p, bones[10]);
            transformVec3Mat4w1(p, this.modelMatrix, p);
        }
    }

    public refPoint(dest: vec3, bones: ReadonlyMat4[], index: RefPointID): void {
        const model = assertExists(this.model);
        const point = model.refPoints[index];
        if (!point) {
            getMatrixTranslation(dest, this.modelMatrix);
            return;
        }
        if (point.pos) {
            vec3.scale(dest, point.pos, 10000 * model.scales.offset/(model.scales.base * model.scales.base));
            transformVec3Mat4w1(dest, bones[point.bone], dest);
        } else
            getMatrixTranslation(dest, bones[point.bone]);
        transformVec3Mat4w1(dest, this.modelMatrix, dest);
    }

    public destroy(device: GfxDevice) {
        if (this.vtxTextures) {
            for (let tex of this.vtxTextures)
                device.destroyTexture(tex);
        }
        if (this.textureCopies) {
            for (let tex of this.textureCopies)
                device.destroyTexture(tex);
        }
    }
}

type basicParser = (data: Int16Array, start: number, log?: (s: string) => void) => number;

export function parseActorMagicCommands(buffer: ArrayBufferSlice, dest: LevelParticles, start: number, end: number): void {
    const view = buffer.createDataView();
    // first there are some indices (a fixed number?)
    const entries: number[] = [];
    let offset = start;
    let minStart = end;
    while (offset < minStart) {
        const value = view.getUint32(offset, true) + offset;
        minStart = Math.min(minStart, value);
        entries.push(value);
        offset += 4;
    }
    for (let i = 0; i < entries.length; i++) {
        entries[i] -= minStart;
        entries[i] /= 2;
    }

    const data = buffer.createTypedArray(Int16Array, minStart, (end - minStart + 1)/2);
    dest.magicEntries = entries;
    dest.magicProgram = data;
}

function otherRef(value: number): string {
    if (value === -0x100)
        return "self";
    if (value === -1)
        return "parent";
    if (value === -2)
        return "grandparent";
    return `other(${hexzero(value & 0xFFFF, 4)})`;
}

function vecParts(mode: number): string {
    let parts = "";
    if (mode & 1)
        parts += "x";
    if (mode & 2)
        parts += "y";
    if (mode & 4)
        parts += "z";
    if (mode & 8)
        parts += "w";
    return parts;
}

function address(start: number, offs: number): string {
    offs = (offs << 0x10) >> 0x10;
    return hexzero(start + offs/2, 4);
}

function vecCompDescByIndex(idx: number): string {
    const vecIndex = idx >>> 2;
    const compIndex = idx & 3;
    return `vec[${vecIndex}].${"xyzw"[compIndex]}`;
}

function vecCompByIndex(vecs: vec4[], idx: number): number {
    const vecIndex = idx >>> 2;
    const compIndex = idx & 3;
    return vecs[vecIndex][compIndex];
}

function rawData(n: number): basicParser {
    return (data: Int16Array, start: number) => {
        const acc: number[] = [];
        for (let i = 0; i < n; i++)
            acc.push(data[start + i]);
        console.log("    ", acc);
        return n;
    }
}

const enum PosMode {
    DEFAULT,
    RADIAL = 2,
    BONE = 4,
}

export class MonsterParticle {
    public pos = vec3.create();
    public vel = vec3.create();
    public accel = vec3.create();
    public scaleAndAngle = vec4.create();
    public color = vec4.create();
    public colorVel = vec4.create();
    public t = 0;
    public lifetime = 0;
    public flipbookIndex = 0;
    public ptr = -1;
    public posMode = PosMode.DEFAULT;
    public center = vec3.create();
    public shouldLoop = false;

    constructor(public emitter: MonsterEmitter){}
}

const particleMtx = mat4.create();
const particleVec = vec3.create();
const particleVec2 = vec3.create();
class MonsterEmitter {
    public particles: MonsterParticle[];
    public nextIndex = 0;

    constructor(public owner: MonsterMagicState, count: number, public data: Int16Array) {
        this.particles = nArray(count, () => new MonsterParticle(this));
    }

    public emit(offs: number, pos: ReadonlyVec3) {
        const p = this.particles[this.nextIndex++];
        this.nextIndex %= this.particles.length;
        p.ptr = offs;
        vec3.copy(p.pos, pos);
        vec3.zero(p.vel);
        vec3.zero(p.accel);
        p.lifetime = 0;
        p.t = 0;
    }

    public run(particleData: ParticleData, viewerInput: ViewerRenderInput, mgr: GfxRenderInstManager, bones: ReadonlyMat4[], actor: Actor): void {
        const dt = Math.min(viewerInput.deltaTime * 30 / 1000, 1);
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            if (p.lifetime <= 0 && p.ptr >= 0)
                processMonsterParticle(this.data, p.ptr, undefined, p);
            if (p.lifetime <= 0)
                continue;

            vec3.scaleAndAdd(p.vel, p.vel, p.accel, dt);
            vec3.scaleAndAdd(p.pos, p.pos, p.vel, dt);
            p.scaleAndAngle[0] += dt * p.scaleAndAngle[1];
            p.scaleAndAngle[2] += dt * p.scaleAndAngle[3];
            vec4.scaleAndAdd(p.color, p.color, p.colorVel, dt);

            const flip = assertExists(particleData.flipbooks[p.flipbookIndex + assertExists(particleData.data.extraFlipbookIndex)]);
            mat4.identity(particleMtx);
            particleMtx[0] = p.scaleAndAngle[0];
            particleMtx[5] = p.scaleAndAngle[0];
            mat4.rotateZ(particleMtx, particleMtx, p.scaleAndAngle[2]);

            switch (p.posMode) {
                case PosMode.RADIAL:
                    const angle = p.pos[2]*Math.PI/0x800;
                    vec3.set(particleVec, Math.cos(angle)*p.pos[0], p.pos[1], Math.sin(angle)*p.pos[0]);
                    vec3.add(particleVec, p.center, particleVec);
                    break;
                case PosMode.BONE:
                    const base = p.center[0];
                    const parent = assertExists(actor.model).bones[base].parent;
                    getMatrixTranslation(particleVec, bones[base]);
                    transformVec3Mat4w1(particleVec, actor.modelMatrix, particleVec);
                    getMatrixTranslation(particleVec2, bones[parent]);
                    transformVec3Mat4w1(particleVec2, actor.modelMatrix, particleVec2);
                    vec3.lerp(particleVec, particleVec, particleVec2, p.center[2]);
                    vec3.scaleAndAdd(particleVec, p.pos, particleVec, 16);
                    break;
                default:
                    vec3.copy(particleVec, p.pos);
                    break;
            }
            vec3.scale(particleVec, particleVec, 1/16);
            transformVec3Mat4w0(particleVec, FFXToNoclip, particleVec);
            transformVec3Mat4w1(particleVec, viewerInput.camera.viewMatrix, particleVec);
            setMatrixTranslation(particleMtx, particleVec);

            vec4.scale(colorScratch, p.color, 2);
            particleData.flipbookRenderer.render(mgr, viewerInput, flip, (p.t % flip.flipbook.frames.length) | 0, colorScratch, particleMtx);
            p.t += dt;
            if (!p.shouldLoop && p.t >= flip.flipbook.frames.length)
                p.lifetime = 0;
            else
                p.lifetime -= dt;
        }
    }
}

const argTemp = nArray(4, () => 0);
function processMonsterParticle(data: Int16Array, start: number, log?:(s: string) => void, p?: MonsterParticle): number {
    let curr = start;
    let running = true;
    let boneListStart = -1;
    while (running && (!p || p.lifetime <= 0)) {
        const value = data[curr];
        const op = value & 0xFF;
        switch (op) {
            case 0:
                running = false;
                if (log) log(`end`);
                curr++;
                break;
            case 1: case 3:
                const timer = value >>> 8;
                if (log) log(`sleep ${op === 3 ? "random " : ""}${timer}`);
                if (p) {
                    if (op === 3)
                        p.lifetime = timer * Math.random();
                    else
                        p.lifetime = timer;
                }
                curr++;
                break;
            case 2: {
                if (log) log(`jump ${address(curr, data[curr+1])}`);
                if (p)
                    curr += data[curr + 1]/2;
                else {
                    // echuilles has a jump to a different particle program
                    if (curr + data[curr+1]/2 < start) {
                        running = false;
                    }
                    curr += 2;
                }
            } break;
            case 4: case 5: case 6: {
                const vecIndex = (value >>> 8) & 7;
                let v: vec3 | null = null;
                if (p) {
                    switch (vecIndex) {
                        case 0: v = p.pos; break;
                        case 1: v = p.vel; break;
                        case 2: v = p.accel; break;
                    }
                }
                let tmpIndex = 0;
                const scale = [0x1, 0x100, 0x1000][vecIndex];
                curr++;
                for (let i = 0; i < 3; i++) {
                    if ((value >>> (12 + i)) & 1) {
                        const comp = data[curr++]/scale;
                        if (v) {
                            if (op === 4)
                                v[i] = comp;
                            else if (op === 5)
                                v[i] += randomRangeFloat(comp);
                            else if (op === 6)
                                v[i] += comp;
                        }
                        argTemp[tmpIndex++] = comp;
                    }
                }
                if (log) {
                    const parts = vecParts(value >>> 12);
                    const target = ["pos", "vel", "accel"][vecIndex];
                    let opName = "= "
                    if (op === 5)
                        opName = "+= random"
                    else if (op === 6)
                        opName = "+= "
                    log(`${target}.${parts} ${opName}(${argTemp.slice(0,tmpIndex)})`);
                }
            } break;
            case 7:
                if (p) {
                    p.flipbookIndex = data[curr + 1];
                    vec4.set(p.color, .5, .5, .5, 1);
                    vec4.zero(p.colorVel);
                    vec4.set(p.scaleAndAngle, 1, 0, 0, 0);
                }
                if (log) log(`setup (flipbook ${data[curr + 1]})`);
                curr += 2;
                break;
            case 8:
                const loop = (value & 0xF000) === 0;
                if (log) log(`set loop ${loop}`);
                if (p) p.shouldLoop = loop;
                curr++;
                break;
            case 9: case 10: {
                const idx = (value >>> 12) & 7;
                const isAngle = idx >= 2;
                const factor = isAngle ? MathConstants.TAU / 0x1000 : 1/0x1000;
                const val = op === 9 ? data[curr + 1] : randomRangeFloat(data[curr + 1]);
                if (p) {
                    if (op === 9)
                        p.scaleAndAngle[idx] = val * factor;
                    else
                        p.scaleAndAngle[idx] += val * factor;
                }
                if (log) {
                    let target = isAngle ? "angle" : "scale";
                    if (idx & 1)
                        target += " vel";
                    const opName = op === 9 ? "=" : "random inc"
                    log(`${target} ${opName} ${data[curr + 1]}`);
                }
                curr += 2;
            } break;
            case 11: {
                const isVel = (value & 0x1000) !== 0;
                argTemp[0] = data[curr + 1] & 0xFF;
                argTemp[1] = (data[curr + 1] >>> 8) & 0xFF;
                argTemp[2] = data[curr + 2] & 0xFF;
                argTemp[3] = (data[curr + 2] >>> 8) & 0xFF;
                if (isVel)
                    for (let i = 0; i < 4; i++) {
                        if (argTemp[i] >= 0x80)
                            argTemp[i] -= 0x100;
                    }
                if (p) {
                    const v = isVel ? p.colorVel : p.color;
                    vec4.set(v, argTemp[0]/0xFF, argTemp[1]/0xFF, argTemp[2]/0xFF, argTemp[3]/0x80);
                }
                if (log) log(`color${isVel ? " vel" : ""} = ${argTemp.map(a=>a.toString(16))}`);
                curr += 3;
            } break;
            case 12: {
                if (p) {
                    p.posMode = value >>> 12;
                    if (p.posMode === PosMode.RADIAL)
                        vec3.copy(p.center, p.pos);
                }
                if (log) log(`pos mode ${value >>> 12}`);
                curr++;
            } break;
            case 13: {

                const vecIndex = (value >>> 8) & 7;
                let v: vec4 | null = null;
                if (p) {
                    v = p.color;
                }
                let tmpIndex = 0;
                const scale = [0x1, 0x100, 0x1000][vecIndex];
                curr++;
                for (let i = 0; i < 4; i++) {
                    if ((value >>> (12 + i)) & 1) {
                        if (v) v[i] = data[curr]/scale;
                        argTemp[tmpIndex++] = data[curr]/scale;
                        curr++;
                    }
                }
                if (log) {
                    const parts = vecParts(value >>> 12);
                    log(`color.${parts} = ${argTemp.slice(0,tmpIndex)}`);
                }
            } break;
            case 16: {
                // the game actually compares this against RNG on [-1,1], making the probability
                // always at least .5, probably just forgot
                const prob = data[curr + 1]/256;
                if (log) log(`with p=${prob} jump to ${address(start, data[curr + 2])}`);
                if (p && Math.random() < prob)
                    curr += data[curr + 2]/2;
                else
                    curr += 3;
            } break;
            case 18: {
                if (p) {
                    assert(data[curr + 1] === 0x3418);
                    p.pos[2] = p.emitter.owner.vecs[0][1];
                }
                if (log) log(`set arb value ${data[curr + 1].toString(16)}`)
                curr += 2;
            } break;
            case 19: {
                const base = data[curr + 1];
                let range = data[curr + 2];
                if (log) log(`frame = random[${base}, ${base + range})`);
                if (p) {
                    if (range < 0)
                        range = 0;//
                    p.t = base + range * Math.random();
                }
                curr += 3;
            } break;
            case 20: {
                boneListStart = curr + data[curr + 1]/2;
                const count = data[boneListStart];
                if (log) log(`random bone ${data.slice(boneListStart+1, boneListStart + count+1)}`);
                if (p) {
                    p.posMode = PosMode.BONE;
                    const idx = (Math.random() * count) | 0;
                    p.center[0] = data[boneListStart + 1 + idx];
                    p.center[2] = Math.random();
                }
                curr += 2;
            } break;
            default:
                running = false;
                throw `bad op ${op}`

        }
    }
    if (p) {
        p.ptr = curr;
        if (!running) {
            p.ptr = -1;
            p.lifetime = -1;
        }
    }
    if (log) log(data.slice(start, curr).toString());
    if (curr === boneListStart)
        curr += data[boneListStart] + 1;
    return curr - start;
}

interface MagicThread {
    pointer: number;
    timer: number;
    saved: number;
    render: boolean;
}

const enum VecOp {
    DEFAULT = 0,
    ANGLE = 3,
}

class DripState {
    private stretchy = false;
    public points: vec3[];
    public prevPos = vec3.create();
    public nextIndex = 0;
    public otherState: MonsterMagicState;
    public full = false;
    private savedLength = 0;
    private floorOffset = 0;

    constructor(public state: MonsterMagicState, public flipbook: number, count: number) {
        this.points = nArray(count, () => vec3.create());
        this.otherState = state;
    }

    public static Stretchy(state: MonsterMagicState, flipbook: number, count: number, floorOffset: number, pos: ReadonlyVec3): DripState {
        const trail = new DripState(state, flipbook, count);
        for (let v of trail.points)
            vec3.copy(v, pos);
        trail.otherState = assertExists(state.parent);
        trail.floorOffset = floorOffset;
        trail.stretchy = true;
        return trail;
    }

    public emit(actor: Actor, state: MonsterMagicState): void {
        if (this.stretchy) {
            this.dripEmit(actor, state.pos);
            return;
        }
        this.otherState = state;
        vec3.copy(this.points[this.nextIndex++], state.pos);
        if (this.nextIndex === this.points.length) {
            this.nextIndex = 0;
            this.full = true;
        }
        let idx = this.step(this.nextIndex);
        this.savedLength = 0;
        for (let i = 0; i < this.points.length - 1; i++) {
            // only wrap if the array is full
            if (idx === 0 && !this.full)
                break;
            const prev = this.step(idx);
            this.savedLength += vec3.dist(this.points[idx], this.points[prev]);
            idx = this.step(idx);
        }
    }

    public dripEmit(actor: Actor, pos: ReadonlyVec3): void {
        const parent = assertExists(this.state.parent);
        const spacing = this.state.vecs[1][3] / (16 * this.points.length);
        vec3.set(posScratch, parent.vecs[1][0], parent.vecs[1][1], parent.vecs[1][2]);
        vec3.scale(posScratch, posScratch, 1/256);
        vec3.copy(this.prevPos, this.points[0]);
        vec3.copy(this.points[0], pos);

        const floorY = actor.groundY + this.floorOffset/16;
        let allOnFloor = true;

        for (let i = 0; i < this.points.length; i++) {
            const ref = this.points[i];
            if (i > 0) {
                vec3.sub(ref, ref, this.points[i-1]);
                vec3.add(ref, ref, posScratch);
                normToLength(ref, spacing);
                vec3.add(ref, ref, this.points[i-1]);
            }
            if (ref[1] > floorY)
                ref[1] = floorY; // inverted Y
            else
                allOnFloor = false;
        }
        if (allOnFloor) {
            if (!(this.state.flags & 1))
                vec4.scale(this.state.vecs[3], this.state.vecs[3], .5);
            this.state.flags |= 1;
        }
    }

    private step(idx: number): number {
        const out = this.stretchy ? idx + 1 : idx - 1;
        if (out >= this.points.length)
            return 0;
        if (out < 0)
            return this.points.length - 1;
        return out;
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput, renderInstManager: GfxRenderInstManager, system: ParticleSystem): void {
        const flipIndex = this.flipbook + assertExists(system.data.data.extraFlipbookIndex);
        const flipbook = assertExists(system.data.flipbooks[flipIndex]);
        const args = trailArgsScratch;
        args.commonFrame = false;
        const paramSource = this.stretchy ? this.otherState : this.state;
        const tailState = this.stretchy ? this.otherState : this.state;
        const headState = this.stretchy ? this.state : this.otherState;
        args.pointCount = 0;
        args.maxLength = paramSource.vecs[0][0];
        const frameStep = paramSource.vecs[0][2]/256;

        // todo: see if this is ever set
        vec4.copy(args.headColor, headState.color);
        vec4.copy(args.tailColor, tailState.color);

        args.scaleRange = 0;
        args.headScale = headState.vecs[0][3]/0x1000;
        args.tailScale = tailState.vecs[0][3]/0x1000;
        args.commonFrame = false;

        // space rendered points evenly across the whole path, but no farther than the max spacing
        const totalLength = this.stretchy ? this.state.vecs[1][3]/16 : this.savedLength;
        const maxSpacing = paramSource.vecs[0][1] * (this.stretchy ? 1/16 : args.maxLength/256);
        const renderSpacing = Math.min(maxSpacing, totalLength)/args.maxLength;
        if (renderSpacing === 0)
            return;
        mat4.mul(particleMtx, viewerInput.camera.viewMatrix, FFXToNoclip);
        let edgeStart = this.stretchy ? 0 : this.step(this.nextIndex);
        let edgeEnd = this.step(edgeStart);
        let distAcc = 0, frame = 0;
        let edgeLen = vec3.dist(this.points[edgeStart], this.points[edgeEnd]);
        fillPoints: for (let i = 0; i < args.maxLength; i++) {
            while (distAcc > edgeLen) {
                edgeStart = this.step(edgeStart);
                edgeEnd = this.step(edgeStart);
                distAcc -= edgeLen;
                if (this.stretchy) {
                    if (edgeStart >= this.points.length - 1)
                        break fillPoints;
                } else {
                    if (edgeStart === 0 && !this.full)
                        break fillPoints;
                }
                edgeLen = vec3.dist(this.points[edgeStart], this.points[edgeEnd]);
            }
            vec3.lerp(args.points[i], this.points[edgeStart], this.points[edgeEnd], distAcc / edgeLen);
            transformVec3Mat4w1(args.points[i], particleMtx, args.points[i]);
            vec3.set(args.params[i], frame*flipbook.flipbook.frames[0].duration, 0, 1);
            args.pointCount++;
            distAcc += renderSpacing;
            frame -= frameStep;
            if (frame < 0)
                frame += flipbook.flipbook.frames.length;
        }
        mat4.identity(particleMtx);
        particleMtx[5] = -1;
        if (args.pointCount > 0)
            system.data.flipbookRenderer.renderTrail(device, renderInstManager, flipbook, 0, particleMtx, args);
    }
}

const colorScratch = vec4.create();
class FlipbookState {
    public alphaSource = -1;
    public scaleSource = -1;
    public frame = 0;

    constructor(public flipbook: number, var0: number, var1: number, public rotation: number) {
        if (var0 === 1)
            this.scaleSource = 0;
        else if (var0 === 2)
            this.alphaSource = 0;
        if (var1 === 1)
            this.scaleSource = 1;
        else if (var1 === 2)
            this.alphaSource = 1;
    }

    public render(state: MonsterMagicState, viewerInput: ViewerRenderInput, renderInstManager: GfxRenderInstManager, system: ParticleSystem): void {
        const flipIndex = this.flipbook + assertExists(system.data.data.extraFlipbookIndex);
        const flipbook = assertExists(system.data.flipbooks[flipIndex]);

        let scale = 1;
        if (this.scaleSource >= 0)
            scale = state.vecs[this.scaleSource][3]/0x1000;
        vec4.copy(colorScratch, state.color);
        if (this.alphaSource >= 0)
            colorScratch[3] = state.vecs[this.alphaSource][3] / 0x80;
        mat4.identity(particleMtx);
        particleMtx[0] = scale;
        particleMtx[5] = -scale;
        // some flag to add vec[0], maybe never set?
        // vec3.set(posScratch, state.vecs[0][0], state.vecs[0][1], state.vecs[0][2]);
        // vec3.scaleAndAdd(posScratch, state.pos, posScratch, 1/16);
        transformVec3Mat4w0(posScratch, FFXToNoclip, state.pos);
        transformVec3Mat4w1(posScratch, viewerInput.camera.viewMatrix, posScratch);
        setMatrixTranslation(particleMtx, posScratch);
        system.data.flipbookRenderer.render(renderInstManager, viewerInput, flipbook, this.frame | 0, colorScratch, particleMtx, state.depthShift);
        this.frame += Math.min(viewerInput.deltaTime * 30 / 1000, 1);
        if (this.frame >= flipbook.flipbook.frames.length) {
            this.frame -= flipbook.flipbook.frames.length;
        }
    }
}

class MonsterMagicState {
    public pos = vec3.create();
    public vecs = nArray(6, vec4.create);
    public parent?: MonsterMagicState;
    public errored = false;
    public alive = true;
    public flags = 0;
    public loopCounts = nArray(4, () => 0);
    public scale: number;
    public vecOp = VecOp.DEFAULT;
    public setPos = true;
    public vecBaseState?: MonsterMagicState;
    public savedChildren: (MonsterMagicState | undefined)[] = [];

    public threads: MagicThread[] = nArray(4, () => ({
        pointer: -1,
        timer: 0,
        saved: -1,
        render: false,
    }));

    public basicEmitter?: MonsterEmitter;
    public fullEmitter?: Emitter;
    public drip?: DripState;
    public flipbook?: FlipbookState;
    public depthShift = 0;
    public color = vec4.fromValues(1, 1, 1, 1);

    constructor(addr: number) {
        this.threads[0].pointer = addr;
    }

    public doVecOp(): void {
        switch (this.vecOp) {
            case VecOp.DEFAULT:
                for (let i = 0; i < 3; i++)
                    this.pos[i] = this.vecs[1][i]/16;
                break;
            case VecOp.ANGLE:
                if (this.vecBaseState)
                    vec3.copy(this.pos, this.vecBaseState.pos);
                else
                    vec3.zero(this.pos);
                const angle = this.vecs[1][2] * MathConstants.TAU / 0x1000;
                const r = this.vecs[1][0]/16;
                this.pos[0] += r*Math.sin(angle);
                this.pos[1] += this.vecs[1][1]/16;
                this.pos[2] += r*Math.cos(angle);
                break;
            default:
                throw `unhandled vec op ${this.vecOp}`;
        }
    }
}

interface MagicRenderContext {
    state: MonsterMagicState;
    bones: ReadonlyMat4[];
    thread: MagicThread;
}

function jump(ctx: MagicRenderContext, offset: number): void {
    ctx.thread.pointer += offset/2;
}

const posScratch = vec3.create();

export class MonsterMagicManager {
    public states: MonsterMagicState[] = [];
    private toNext = 1;

    constructor(public entries: number[], public data: Int16Array, public actor: Actor) {}

    public startEffect(slot: number): void {
        const firstOp = this.data[this.entries[slot]];
        if (firstOp === 0 || firstOp === 0x7F)
            return;
        this.states.push(
            new MonsterMagicState(this.entries[slot])
        );
    }

    public update(dt: number, bones: ReadonlyMat4[], data: ParticleData, viewerInput: ViewerRenderInput, mgr: GfxRenderInstManager, device: GfxDevice) {
        this.toNext -= dt;
        if (this.toNext <= 0) {
            this.toNext += 1;
            this.tick(dt, bones);
        }

        for (let i = 0; i < this.states.length; i++) {
            const s = this.states[i];
            if (s.threads[0].pointer < 0)
                continue;
            if (s.basicEmitter)
                s.basicEmitter.run(data, viewerInput, mgr, bones, this.actor);
            // we shouldn't need to reference other objects
            if (s.fullEmitter)
                s.fullEmitter.update(device, null!, viewerInput, mgr, assertExists(this.actor.particles));
            if (s.drip)
                s.drip.render(device, viewerInput, mgr, assertExists(this.actor.particles));
            if (s.flipbook)
                s.flipbook.render(s, viewerInput, mgr, assertExists(this.actor.particles));
        }
    }

    private tick(dt: number, bones: ReadonlyMat4[]) {
        const context: MagicRenderContext = {
            state: this.states[0],
            bones,
            thread: null!,
        };
        let anyDeadStates = false;
        for (let i = 0; i < this.states.length; i++) {
            const state = this.states[i];
            if (state.errored)
                continue;
            for (let phase = 0; phase < 2; phase++) {
                const isRender = phase === 1;
                for (let j = 0; j < state.threads.length; j++) {
                    const thread = state.threads[j];
                    if (thread.render !== isRender || thread.pointer < 0)
                        continue;
                    if (thread.timer > 0)
                        thread.timer--;
                    if (thread.timer === 0) {
                        context.state = state;
                        context.thread = thread;
                        while (thread.timer === 0 && thread.pointer >= 0) {
                            const prev = thread.pointer;
                            const step = this.processOp(thread.pointer, context);
                            // a positive step is really the size of the instruction,
                            // which isn't the amount to advance if it was a jump or a sleep
                            if (step < 0) {
                                state.errored = true;
                                break;
                            } else if (thread.pointer === prev && thread.timer === 0) {
                                thread.pointer += step;
                            }

                        }
                    }
                }
                if (!isRender) {
                    for (let j = 3; j >= 0; j--)
                        vec4.add(state.vecs[j], state.vecs[j], state.vecs[j+2]);
                    if (state.setPos) {
                        state.doVecOp();
                    }
                }
            }
            if (!state.alive)
                anyDeadStates = true;
        }
        if (anyDeadStates) { // hopefully we don't need to be careful here
            this.states = this.states.filter((s)=>s.alive);
        }
    }

    public processOp(start: number,
        ctx?: MagicRenderContext,
        log?: (desc: string) => void,
        mark?: (start: number, parser: basicParser) =>void): number {
        const data = this.data;
        let offs = start;
        const base = data[offs++] & 0xFFFF;
        const op = base & 0xFF;
        const mode = base >>> 12;
        switch (op) {
            case 0x00: case 0x7F: {
                if (log) log("end");
                if (ctx) {
                    ctx.thread.pointer = -1;
                    if (ctx.state.threads[0].pointer === -1)
                        ctx.state.alive = false;
                }
                return 1;
            }
            case 0x01: {
                if (log) log("end all");
                if (ctx) {
                    for (let i = 0; i < ctx.state.threads.length; i++)
                        ctx.state.threads[i].pointer = -1;
                    ctx.state.alive = false;
                }
                return 1;
            }
            case 0x02: {
                if (log) log(`jump ${address(start, data[offs])}`);
                if (ctx) jump(ctx, data[offs]);
                return 2;
            }
            case 0x03: {
                if (log) log(`call ${address(start, data[offs])}`);
                if (ctx) {
                    ctx.thread.saved = start + 2;
                    jump(ctx, data[offs]);
                }
                return 2;
            }
            case 0x04: {
                if (log) log(`return`);
                if (ctx) ctx.thread.pointer = ctx.thread.saved;
                return 1;
            }
            case 0x05: {
                if (mode === 1) {
                    if (log) log(`unset tracker flags ${data[offs].toString(16)}`);
                    return 2;
                } else if (mode === 5) {
                    if (log) log(`wait tracker flags set ${data[offs].toString(16)}`);
                    if (ctx) {
                        // not really implemented for now
                        ctx.thread.timer = 60;
                        return 0;
                    }
                    return 2;
                }
            } break;
            case 0x09: {
                const dur = (base >>> 9);
                if (log) log(`sleep ${dur}`);
                if (ctx) {
                    ctx.thread.timer = dur;
                    jump(ctx, 2);
                }
                return 1;
            }
            case 0x0A: case 0x0B: case 0x0C: case 0x0D: case 0x0E: case 0x0F:
            case 0x12: case 0x13: case 0x14: case 0x15: case 0x16: case 0x17:
            case 0xD6: case 0xD7: case 0xD8: case 0xD9: case 0xDA: case 0xDB:
            {
                let base = 0x0A;
                if (op >= 0xD6)
                    base = 0xD6;
                else if (op >= 0x12)
                    base = 0x12;
                const index = op - base;
                let scale = 1;
                if (index >= 4)
                    scale = 0x1000;
                else if (index >= 2)
                    scale = 0x100;
                let tempIndex = 0;
                for (let i = 0; i < 4; i++) {
                    if (mode & (1 << i)) {
                        const val = data[offs++]/scale;
                        if (ctx) {
                            if (base === 0x12)
                                ctx.state.vecs[index][i] += randomRangeFloat(val);
                            else if (base === 0xD6)
                                ctx.state.vecs[index][i] += val;
                            else
                                ctx.state.vecs[index][i] = val;
                        }
                        argTemp[tempIndex++] = val;
                    }
                }
                if (base & 0xA00)
                    debugger
                if (log) {
                    let action = "=";
                    if (base === 0xD6)
                        action = "+=";
                    else if (base === 0x12)
                        action = "+= random";
                    const parts = vecParts(mode);
                    log(`vec[${index}].${parts} ${action}(${argTemp.slice(0,tempIndex)})`);
                }
                return offs - start;
            }
            case 0x1D: {
                assert(data[offs] === -1);
                if (log) log(`wait for parent death`);
                if (ctx) {
                    if (ctx.state.parent && !ctx.state.parent.alive) {
                        ctx.state.alive = false;
                        ctx.thread.pointer = -1;
                    } else
                        ctx.thread.timer = 1;
                }
                return 2;
            } break;
            case 0x1E: {
                const otherMode = (base & 0xE00) >>> 9;
                let iterDesc = "";
                let iters = 0;
                let step = -1
                if (otherMode === 0) {
                    if (log) iterDesc = `${data[offs]}`;
                    iters = data[offs];
                    step = 2;
                } else if (otherMode === 2) {
                    if (log) iterDesc = `${data[offs]} + rand(${data[offs + 1]})`
                    iters = data[offs] + (data[offs + 1]*Math.random()) | 0;
                    step = 3;
                }
                if (step >= 0) {
                    if (log) log(`start loop ${mode}: ${iterDesc} iters`);
                    if (ctx) ctx.state.loopCounts[mode] = iters;
                    return step;
                }
            } break;
            case 0x1F:
                if (log) log(`end loop ${mode} (from ${address(start, data[offs])})`);
                if (ctx) {
                    ctx.state.loopCounts[mode]--;
                    if (ctx.state.loopCounts[mode] > 0)
                        jump(ctx, data[offs]);
                }
                return 2;
            case 0x22: if (log) log(`damage set`); return 1; // ???
            case 0x23: if (log) log(`blend = ${(data[offs] & 0xFFFF).toString(16)}`); return 2;
            case 0x24: case 0x25: {
                const v0Use = base >>> 13;
                const v1Use = (base >>> 9) & 7;
                if (log) log(`flipbook ${data[offs]} (v0:${v0Use}, v1:${v1Use}, full euler:${op - 0x24})`)
                if (ctx) {
                    ctx.state.flipbook = new FlipbookState(data[offs], v0Use, v1Use, op - 0x24);
                }
                return 2;
            } break;
            case 0x26: {
                const renderPhase = (base & 0x8000) !== 0;
                const rawIndex = mode & 3;
                const refOffset = data[offs++];
                if (ctx) {
                    let idx = rawIndex;
                    if (idx === 0) {
                        idx = -1;
                        for (let i = 1 ; i < ctx.state.threads.length; i++) {
                            if (ctx.state.threads[i].pointer < 0) {
                                idx = i;
                                break;
                            }
                        }
                    }
                    if (idx > 0) {
                        ctx.state.threads[idx].pointer = start + refOffset/2;
                        ctx.state.threads[idx].render = renderPhase;
                        ctx.state.threads[idx].timer = 0;
                    }
                }
                if (log) {
                    const idxString = rawIndex ? ` @${rawIndex} ` : "";
                    log(`queue ${address(start, refOffset)}${idxString}${renderPhase ? ' (render)' : ''}`);
                }
                return 2;
            }
            case 0x27: {
                if (mode === 0) {
                    if (log) log(`load textures ${data[offs]}`);
                    return 2;
                } else if (mode === 1) {
                    if (log) log('texture lists');
                    return 2;
                } else if (mode === 2) {
                    if (log) log('tex process');
                    return 2;
                } else if (mode === 3) {
                    if (log) log('tex wait');
                    return 1;
                }
            } break;
            case 0x28: {
                if (mode === 0) {
                    if (log) log(`upload clut ${data[offs]}`);
                    return 2;
                }
            } break;
            case 0x2A: if (log) log(`clear streams ${mode}`); return 1;
            case 0x2B: {
                if (log) log(`six stuff`);
                switch (mode) {
                    case 0: return 2;
                    case 1: case 2:
                        return 1;
                    case 3: return 1; // wait
                    case 4: case 5:
                        return 3;
                }
            } break;
            case 0x2E: case 0x2F: {
                if (op === 0x2E) {
                    const ref = data[offs++];
                    assert(ref < 0 && ref > -10);
                }
                const flag = data[offs++] & 0xFFFF;
                let masked = 0;
                assert(mode < 7);
                let state = null;
                if (ctx) {
                    state = op === 0x2E ? (ctx.state.parent || ctx.state) : ctx.state;
                    masked = state.flags & flag;
                }
                let branchOffs = 0;
                if (mode === 2 || mode === 3)
                    branchOffs = data[offs++];
                let verb = "idk";
                switch (mode) {
                    case 0:
                        verb = "set";
                        if (state) state.flags |= flag;
                        break;
                    case 1:
                        verb = "unset";
                        if (state) state.flags &= ~flag;
                        break;
                    case 2:
                        verb = "bnez";
                        if (ctx && (masked !== 0)) {
                            ctx.thread.pointer += branchOffs / 2;
                        }
                        break;
                    case 3:
                        verb = "bez";
                        if (ctx && (masked === 0))
                            ctx.thread.pointer += branchOffs / 2;
                        break;
                    case 4:
                        verb = "wait ez";
                        if (ctx && (masked !== 0))
                            ctx.thread.timer = 1;
                        break;
                    case 5:
                        verb = "wait nez";
                        if (ctx && (masked === 0))
                            ctx.thread.timer = 1;
                        break;
                }
                if (log) {
                    const tag = op === 0x2E ? 'parent' : '';
                    const branch = branchOffs !== 0 ? ` to ${address(start, branchOffs)}` : '';
                    log(`${verb} ${tag} flag ${hexzero(flag, 4)}${branch}`);
                }
                return offs - start;
            }
            case 0x32: {
                const refOffset = data[offs++];
                if (log) log(`fork ${address(start, refOffset)}`);
                if (ctx) {
                    const child = new MonsterMagicState(start + refOffset/2);
                    child.parent = ctx.state;
                    vec4.copy(child.vecs[0], ctx.state.vecs[0]);
                    vec4.copy(child.vecs[1], ctx.state.vecs[1]);
                    vec3.copy(child.pos, ctx.state.pos);
                    this.states.push(child);
                }
                return 2;
            }
            case 0x33: if (log) log(`buffer id = ${data[offs++]}`); return 2;
            case 0x36: {
                let t = -1, inc = -1;
                if (mode === 0) {
                    assert(data[offs + 1] === -1);
                    assert(data[offs + 2] === -2);
                    if (log) log(`pos lerp ${otherRef(data[offs + 1])} to ${otherRef(data[offs + 2])}, frac ${vecCompDescByIndex(data[offs])}`);
                    if (ctx) t = vecCompByIndex(ctx.state.vecs, data[offs]);
                    inc = 4;
                } else if (mode === 1) {
                    assert(data[offs] === -1);
                    assert(data[offs + 1] === -2);
                    if (log) log(`pos lerp ${otherRef(data[offs])} to ${otherRef(data[offs + 1])}, frac arb ${data[offs + 2]}`);
                    t = data[offs + 2];
                    inc = 4;
                }
                if (inc > 0) {
                    if (ctx) {
                        const parent = assertExists(ctx.state.parent);
                        const gp = assertExists(parent.parent);
                        vec3.lerp(ctx.state.pos, parent.pos, gp.pos, t/0x1000);
                    }
                    return inc;
                }
            } break;
            case 0x37: {
                if (log) log(`reset vecs (mode ${mode})`);
                if (ctx) {
                    if (mode === 0) {
                        vec4.zero(ctx.state.vecs[0]);
                        vec4.zero(ctx.state.vecs[1]);
                    } else if (mode === 1) {
                        vec4.set(ctx.state.vecs[1], 0, 0, 0, ctx.state.vecs[1][3]);
                    } else if (mode === 2) {
                        vec4.set(ctx.state.vecs[0], 0, 0, 0, ctx.state.vecs[0][3]);
                    } else if (mode === 4) {
                        vec4.zero(ctx.state.vecs[2]);
                        vec4.zero(ctx.state.vecs[3]);
                        vec4.zero(ctx.state.vecs[4]);
                        vec4.zero(ctx.state.vecs[5]);
                    } else if (mode === 5) {
                        vec4.set(ctx.state.vecs[3], 0, 0, 0, ctx.state.vecs[3][3]);
                        vec4.set(ctx.state.vecs[5], 0, 0, 0, ctx.state.vecs[5][3]);
                    } else if (mode === 6) {
                        vec4.set(ctx.state.vecs[2], 0, 0, 0, ctx.state.vecs[2][3]);
                        vec4.set(ctx.state.vecs[4], 0, 0, 0, ctx.state.vecs[4][3]);
                    }
                }
                return 1;
            } break;
            case 0x38: {
                if (mode === 0) {
                    if (log) log(`actor[var].color = vec[1]`);
                    return 1;
                }
            } break;
            case 0x40: {
                let justAlpha = false;
                let vecSource = -1;
                let other = -0x100;
                switch (mode) {
                    case 0:
                        other = data[offs++];
                        vecSource = 1;
                        break;
                    case 1:
                        other = data[offs++];
                        vecSource = 1; // TODO: scaled
                        break;
                    case 2: break; // literal
                    case 3:
                        vecSource = 0;
                        break;
                    case 4:
                        other = data[offs++];
                        vecSource = 0;
                        break;
                    case 5:
                        justAlpha = true;
                        break;
                    default:
                        throw `bad color (0x40) mode ${mode}`;
                }
                if (log) {
                    let source = "";
                    if (vecSource >= 0) {
                        source = `${other === -0x100 ? '' : (otherRef(other) + '.')}vec[${vecSource}]`;
                    } else if (justAlpha) {
                        source = data[offs++].toString();
                    } else {
                        source = data.slice(offs, offs + 4).toString();
                        offs += 4;
                    }
                    log(`color${justAlpha ? ".a" : ""} = ${source}`);
                }
                if (ctx) {
                    if (justAlpha) {
                        ctx.state.color[3] = data[offs++]/0x80;
                    } else if (vecSource >= 0) {
                        assert(other === -1 || other === -0x100);
                        const refState = other === -1 ? assertExists(ctx.state.parent) : ctx.state;
                        vec4.scale(ctx.state.color, refState.vecs[vecSource], 1/0x80);
                    } else {
                        vec4.set(ctx.state.color, data[offs], data[offs + 1], data[offs + 2], data[offs + 3]);
                        vec4.scale(ctx.state.color, ctx.state.color, 1/0x80);
                        offs += 4;
                    }
                }
                return offs - start;
            }
            case 0x4A: {
                if (mode === 0) {
                    if (log) log(`drip flip ${data[offs]} x${data[offs+1]}`);
                    if (ctx) {
                        ctx.state.drip = new DripState(ctx.state, data[offs], data[offs + 1]);
                    }
                    return 3;
                } else if (mode === 1) {
                    const count = data[offs + 1];
                    assert(data[offs + 2] === -1); // parent
                    if (log) log(`stretchy drip flip ${data[offs]} x${count} param ${data[offs + 3]}`);
                    if (ctx) {
                        ctx.state.drip = DripState.Stretchy(ctx.state, data[offs], count, data[offs + 3], ctx.state.pos);
                    }
                    return 5;
                }
            } break;
            case 0x4D: {
                if (mode === 0) {
                    if (log) log(`save (colored rect)`);
                    return 2;
                } else if (mode === 1 || mode === 2) {
                    if (log) log(`rect color:vec[1] blend:${(data[offs]&0xFFFF).toString(16)}${mode === 2 ? " on hook":""}`);
                    return 2;
                }
            } break;
            case 0x53: {
                const other = data[offs];
                if (log) log(`update drip ${otherRef(other)}`);
                if (ctx) {
                    assert(other === -1 || other === -0x100);
                    const trail = other === -1 ? assertExists(ctx.state.parent).drip : ctx.state.drip;
                    // seems like this is accidentally called for the basilisk??
                    // use current state pos even if the parent has the trail
                    trail?.emit(this.actor, ctx.state);
                }
                return 2;
            }
            case 0x5A: {
                if (log) log(`vec op = ${data[offs]}; a0,2 = ${data[offs+1]},${data[offs+2]}`);
                if (ctx) {
                    ctx.state.vecOp = data[offs];
                    assert(data[offs + 1] === 0);
                    ctx.state.vecBaseState = ctx.state.parent; // TODO: ???
                }
                return 4;
            } break;
            case 0x5F: {
                if (log) log(`actor pos (${mode})`);
                if (ctx) {
                    if (mode === 0) {
                        for (let i = 0; i < 3; i++)
                            ctx.state.vecs[1][i] = 16*this.actor.pos[i];
                        vec3.copy(ctx.state.pos, this.actor.pos);
                        return 1;
                    } else if (mode === 1) {
                        const model = assertExists(this.actor.model);
                        const point = assertExists(model.refPoints[3]);
                        getMatrixTranslation(ctx.state.pos, ctx.bones[point.bone]);
                        transformVec3Mat4w1(ctx.state.pos, this.actor.modelMatrix, ctx.state.pos);
                        ctx.state.pos[1] = this.actor.pos[1] - model.scales.height/2;
                        for (let i = 0; i < 3; i++)
                            ctx.state.vecs[1][i] = 16*ctx.state.pos[i];
                        return 1;
                    }
                }
            } break;
            case 0x61: {
                const params = data[offs++];
                const index = params & 7;
                assert(index < 6);
                assert(data[offs] === -1); // parent
                const copyPos = (params & 0x10) !== 0;
                for (let i = 0; i < 4; i++) {
                    if ((params >>> (12 + i)) & 1) {
                        if (ctx) {
                            ctx.state.vecs[index][i] = assertExists(ctx.state.parent).vecs[index][i];
                            if (copyPos)
                                ctx.state.pos[i] = assertExists(ctx.state.parent).pos[i];
                        }
                    }
                }
                if (log) {
                    const parts = vecParts(params >>> 12);
                    const alsoPos = copyPos ? " (also pos)" : "";
                    log(`vec[${index}].${parts} = parent.vec[${index}].${parts}${alsoPos}`);
                };
                return 3;
            }
            case 0x64: {
                if (mode === 0) {
                    if (log) log(`var = targets[0]`);
                    return 1;
                } else if (mode === 1) {
                    if (log) log(`var = ${data[offs]}`);
                    return 2;
                } else if (mode === 8) {
                    if (log) log(`var = actorIndex`);
                    return 1;
                }
            } break;
            case 0x68: {
                if (mode === 0 || mode === 1) {
                    if (log) log(`matrix source (b8) = ${data[offs]}, 19 & 0x80 : ${mode === 1}`);
                    return 2;
                }
            } break;
            case 0x6B: {
                if (mode === 0) {
                    if (log) log(`force flipbook loop`); // only matters if the flipbook doesn't already loop
                    return 1;
                } else if (mode === 1) {
                    if (log) log(`flipbook scale/roll ${data[offs].toString(16)} (unused ${data[offs+1]})`);
                    return 3; // unused value?
                } else if (mode === 2) {
                    if (log) log(`depth shift = ${base & 0x200 ? "r * " : ""}${data[offs]}`);
                    if (ctx) ctx.state.depthShift = data[offs]/16;
                    return 2;
                }
            } break;
            case 0x6F: {
                if (mode === 6) {
                    if (log) log(`fill tex for geo[${data[offs]}..${data[offs]+data[offs+1]}], @${address(start, data[offs+2])}`);
                    if (mark) mark(start + data[offs+2]/2, rawData(4));
                    return 4;
                }
            } break;
            case 0x70: {
                const flag = data[offs++] & 0xFFFF;
                if (mode === 0 || mode === 1) {
                    const isBEQ = mode === 0;
                    const branchDest = data[offs++];
                    if (log) log(`effect level b${isBEQ ? "eq" : "ne"} ${hexzero(flag, 2)} to ${address(start, branchDest)}`);
                    if (ctx) {
                        const equals = this.actor.effectLevel === flag;
                        if (equals === isBEQ)
                            jump(ctx, branchDest);
                    }
                    return 3;
                }
                if (mode === 2 || mode === 3) {
                    const branchDest = data[offs++];
                    const bez = mode === 3;
                    if (log) log(`effect level & ${hexzero(flag, 2)} ${bez ? '=' : '!'}= 0 to ${address(start, branchDest)}`);
                    if (ctx) {
                        const isZero = (this.actor.effectLevel & flag) === 0;
                        if (isZero === bez)
                            jump(ctx, branchDest);
                    }
                    return 3;
                }
                if (mode === 4 || mode === 5) {
                    const waitEQ = mode === 5;
                    if (log) log(`wait effect level ${waitEQ ? "=" : "!"}= ${flag}`);
                    if (ctx) {
                        const isEqual = this.actor.effectLevel === flag;
                        if (isEqual !== waitEQ)
                            ctx.thread.timer = 1;
                    }
                    return 2;
                }
            } break;
            case 0x72: {
                if (mode === 0 || mode === 1 || mode === 2) {
                    if (log) log(`vec[0].xyz = (0, heading, 0)`);
                    if (ctx) {
                        const heading = this.actor.heading * 0x800/Math.PI;
                        if (mode === 1)
                            ctx.state.vecs[1][2] = heading;
                        else {
                            ctx.state.vecs[0][1] = heading;
                            if (mode === 0) {
                                ctx.state.vecs[0][0] = 0;
                                ctx.state.vecs[0][2] = 0;
                            }
                        }
                    }
                    return 1;
                }
            } break;
            case 0x80: {
                if (mode === 2) {
                    if (log) log(`save to ${otherRef(data[offs])} @${hexzero(data[offs+1],2)}`);
                    if (ctx) {
                        assert(data[offs] === -1);
                        const index = (data[offs + 1] - 0xA8)/2;
                        assertExists(ctx.state.parent).savedChildren[index] = ctx.state;
                    }
                    return 3;
                } else if (mode === 0) {
                    if (log) log(`sib ${data[offs]} maybe jump to ${address(start, data[offs+1])}`);
                    return 3;
                } else if (mode === 1) {
                    if (log) log(`idk`)
                    return 1;
                } else if (mode === 3) {
                    const otherOffset = data[offs];
                    const threadIndex = data[offs + 1];
                    const jump = data[offs + 2];
                    if (log) log(`jump saved @(${otherOffset.toString(16)})[${threadIndex}] to ${address(start, jump)}`);
                    if (ctx) {
                        const index = (otherOffset - 0xA8)/2;
                        const maybeChild = ctx.state.savedChildren[index];
                        if (maybeChild)
                            maybeChild.threads[threadIndex].pointer = start + jump/2;
                    }
                    return 4;
                }
            } break;
            case 0x84: {
                const sub = data[offs];
                if (sub === 4) {
                    if (log) log(`wait battle ready`);
                    return 2;
                } else if (sub === 8) {
                    if (log) log(`init geos[${data[offs+1]}..${data[offs+1]+data[offs+2]}], mode ${data[offs+3]}`);
                    return 5;
                } else if (sub === 9) {
                    if (log) log(`move shatter ${data[offs + 1]}`);
                    return 3;
                } else if (sub === 10) {
                    if (log) log(`render shatter color source:${data[offs+1]} lights@${address(start, data[offs+2])} ${data[offs+3]}`);
                    if (mark) mark(start + data[offs+2]/2, rawData(4));
                    return 5;
                } else if (sub === 11) {
                    if (log) log(`render shatter hightlights color source:${data[offs+1]} lights@${address(start, data[offs+2])} ${data[offs+3]}`);
                    if (mark) mark(start + data[offs+2]/2, rawData(4));
                    return 5;
                }
            } break;
            case 0x8C: {
                if (mode === 1) {
                    if (log) log(`${vecCompDescByIndex(data[offs])} = height * ${data[offs+1]/16}`);
                    return 3;
                } else if (mode === 2) {
                    if (log) log(`pos = vecOp(vec[1])`);
                    if (ctx) ctx.state.doVecOp();
                    return 1;
                } else if (mode === 5) {
                    if (log) log('vec[3] = pos - (prev pos)');
                    if (ctx) {
                        const trail = assertExists(ctx.state.drip);
                        vec3.sub(posScratch, ctx.state.pos, trail.prevPos);
                        vec3.scale(posScratch, posScratch, 16);
                        vec4.set(ctx.state.vecs[3], posScratch[0], posScratch[1], posScratch[2], ctx.state.vecs[3][3]);
                    }
                    return 2;
                }
            } break;
            case 0x8F: {
                if (mode === 0) {
                    if (log) log(`alloc particles ${data[offs]}`);
                    if (ctx) {
                        ctx.state.basicEmitter = new MonsterEmitter(ctx.state, data[offs], data);
                    }
                    return 2;
                } else if ((mode & 7) === 1) {
                    if (log) log(`emit particle ${address(start, data[offs])}`);
                    if (mark) mark(start + data[offs]/2, processMonsterParticle);
                    if (ctx && ctx.state.basicEmitter) {
                        if (mode & 8) {
                            vec3.scale(posScratch, ctx.state.pos, 16); // we'll divide by 16 again later...
                        } else {
                            vec3.set(posScratch, ctx.state.vecs[1][0], ctx.state.vecs[1][1], ctx.state.vecs[1][2]);
                        }
                        ctx.state.basicEmitter.emit(start + data[offs]/2, posScratch);
                    }
                    return 2;
                } else if (mode === 2) {
                    if (log) log(`emit other particle ${otherRef(data[offs + 1])} ${data[offs]}`);
                    if (mark) mark(start + data[offs]/2, processMonsterParticle);
                    return 3;
                }
            } break;
            case 0x96: {
                if (mode === 0) {
                    if (log) log(`save offset (?)`);
                    return 1;
                }
            } break;
            case 0x98: case 0x99: {
                const scale = op === 0x98 ? '.001x' : '';
                let boneIndex = data[offs++];
                let useBone = (boneIndex & 0x8000) === 0;
                let out = -1;
                let setVec1 = true;
                switch (mode) {
                    case 0:
                        boneIndex &= 0x7FFF;
                        if (log) log(`vec[1] = ${scale} ${useBone ? "bone" : "ref"}[${boneIndex}].offset`);
                        out = 2;
                        vec3.zero(posScratch);
                        break;
                    case 1:
                        if (log) log(`vec[1] = ${scale} bone[${boneIndex & 0x7FFF}] . vec[0]`);
                        if (ctx) {
                            const src = ctx.state.vecs[0];
                            vec3.set(posScratch, src[0], src[1], src[2]);
                        }
                        out = 2;
                        break;
                    case 3: {
                        if (log) log(`vec[1] = ${scale} mtx . bone[random].offset`);
                        if (ctx) {
                            vec3.zero(posScratch);
                            const boneCount = assertExists(this.actor.model).bones.length;
                            if (boneCount < 5)
                                boneIndex = boneCount - 1;
                            else
                                boneIndex = 4 + Math.random()*(boneCount - 5) | 0;
                        }
                        out = 1;
                    } break;
                    case 4: {
                        assert(boneIndex === 3);
                        if (log) log(`vec[1] = ${scale} bone[vecs[0].w] . vec[0]`);
                        if (ctx) {
                            const src = ctx.state.vecs[0];
                            vec3.set(posScratch, src[0], src[1], src[2]);
                            boneIndex = ctx.state.vecs[0][3];
                        }
                        out = 2;
                    } break;
                    case 5: {
                        if (log) log(`vec[1] = ${scale} bone[${boneIndex}] . (${data[offs]}, ${data[offs+1]}, ${data[offs+2]})`);
                        vec3.set(posScratch, data[offs], data[offs + 1], data[offs + 2]);
                        out = 5;
                    } break;
                    case 8: {
                        const order = data[offs];
                        if (log) log(`pos = .001 * bone[${boneIndex}] . cylindrical(vec[1]) (order ${order})`);
                        if (ctx) {
                            const angle = ctx.state.vecs[1][2] * MathConstants.TAU / 0x1000;
                            posScratch[1] = ctx.state.vecs[1][1] / 16000;
                            const r = ctx.state.vecs[1][0] / 16000;
                            posScratch[0] = r*Math.sin(angle);
                            posScratch[2] = r*Math.cos(angle);
                            assert(order <= 1);
                            if (order === 1) {
                                const y = posScratch[1];
                                posScratch[1] = posScratch[0];
                                posScratch[0] = y;
                            }
                        }
                        setVec1 = false;
                        out = 3;
                    } break;
                }
                if (out > 0) {
                    if (ctx) {
                        if (useBone) {
                            vec3.scale(posScratch, posScratch, 10/assertExists(this.actor.model).scales.base);
                            transformVec3Mat4w1(posScratch, ctx.bones[boneIndex & 0x7FFF], posScratch);
                            transformVec3Mat4w1(posScratch, this.actor.modelMatrix, posScratch);
                        } else {
                            this.actor.refPoint(posScratch, ctx.bones, boneIndex);
                        }
                        vec3.copy(ctx.state.pos, posScratch);
                        vec3.scale(posScratch, posScratch, 16);
                        vec4.set(ctx.state.vecs[1], posScratch[0], posScratch[1], posScratch[2], ctx.state.vecs[1][3]);
                    }
                    return out;
                }
            } break;
            case 0xa1: {
                if (mode === 0) {
                    const prob = data[offs]/256;
                    const target = data[offs+1];
                    if (log) log(`with p=${prob}, jump to ${address(start, target)}`);
                    if (ctx && Math.random() < prob)
                        jump(ctx, target);
                    return 3;
                } else if (mode === 7) {
                    const id = data[offs];
                    const target = data[offs+1];
                    if (log) log(`if model = ${id.toString(16)} jump to ${address(start, target)}`);
                    if (ctx && this.actor.id === id) {
                        jump(ctx, target);
                    }
                    return 3;
                }
            } break;
            case 0xa9:
                const isParent = (base & 0x400) !== 0;
                const twoVar = (base & 0x800) !== 0;
                const setVec = (base & 0x200) !== 0;
                if (isParent)
                    assert(data[offs++] === -1);
                let destOffs = 0, leftOffs = 0, rightOffs = 0;
                if (twoVar) {
                    destOffs = data[offs] & 0xFF;
                    leftOffs = (data[offs] >>> 8) & 0xFF;
                    rightOffs = data[offs + 1] & 0xFF;
                } else {
                    rightOffs = data[offs]; // actually an immmediate value
                    destOffs = data[offs + 1] & 0xFF;
                    leftOffs = (data[offs + 1] >>> 8) & 0xFF;
                }
                assert(destOffs % 4 === 0 && destOffs >= 0x30 && destOffs < 0x90);
                assert(leftOffs % 4 === 0 && leftOffs >= 0x30 && leftOffs < 0x90);
                if (twoVar)
                    assert(rightOffs % 4 === 0 && rightOffs >= 0x30 && rightOffs < 0x90);
                const leftIndex = (leftOffs - 0x30)/4;
                const destIndex = (destOffs - 0x30)/4;
                const rightIndex = (rightOffs - 0x30)/4;
                if (ctx) {
                    const vecs = isParent ? assertExists(ctx.state.parent).vecs : ctx.state.vecs;
                    const left = vecCompByIndex(vecs, leftIndex);
                    const right = twoVar ? vecCompByIndex(vecs, rightIndex) : rightOffs;
                    let final = 0;
                    switch (mode) {
                        case 0: final = left + right; break;
                        case 1: final = left - right; break;
                        case 2: final = left * right; break;
                        case 3: final = left / right; break;
                    }
                    const destVecIndex = destIndex >>> 2;
                    const destCompIndex = destIndex & 3;
                    vecs[destVecIndex][destCompIndex] = final;
                }
                if (log) {
                    const op = "+-*/"[mode];
                    const target = isParent ? "parent." : "";
                    let right = "";
                    const left = `${target}${vecCompDescByIndex(leftIndex)}`;
                    if (twoVar) {
                        right = `${target}${vecCompDescByIndex(rightIndex)}`;
                    } else {
                        right = rightOffs.toString();
                    }
                    log(`${target}${vecCompDescByIndex(destIndex)} = ${left} ${op} ${right}${setVec ? "; vecOp" : ""}`);
                }
                return 3 + (isParent ? 1 : 0);
            case 0xab: {
                if (mode === 1) {
                    if (log) log(`copy frame ${data[offs]} to d0`);
                    return 2;
                } else if (mode === 4) {
                    if (log) log(`load image ${data[offs].toString(16)} bp${data[offs+1].toString(16)} (${data[offs+4]},${data[offs+5]}) ${data[offs+6]}x${data[offs+7]}`);
                    return 9;
                } else if (mode === 5) {
                    if (log) log(`store image ${data[offs].toString(16)} bp${data[offs+1].toString(16)} (${data[offs+4]},${data[offs+5]}) ${data[offs+6]}x${data[offs+7]}`);
                    return 9;
                } else if (mode === 6) {
                    if (log) log(`hook image`);
                    return 1;
                }
            } break;
            case 0xac: {
                if (mode === 0) {
                    if (log) log(`pos = (vec[1] + (random vec of len ${vecCompDescByIndex(data[offs] & 0xF)})/16`);
                    return 2;
                }
                if (mode === 1) {
                    if (log) log(`pos = (vec[1] + randomCube(vec[0]))`);
                    return 1;
                }
            }
            case 0xb0: {
                if (mode === 0) {
                    if (log) log(`random sleep ${data[offs]}`);
                    if (ctx) {
                        const dur = (Math.random() * data[offs]) | 0;
                        ctx.thread.timer = dur;
                        jump(ctx, 4);
                    }
                    return 2;
                } else if (mode === 8) {
                    const other = data[offs];
                    assert(other === -1);
                    if (log) log(`wait until parent is root`);
                    if (ctx) {
                        if (ctx.state.parent && ctx.state.parent.parent)
                            ctx.thread.timer = 1;
                    }
                    return 2;
                }
            } break;
            case 0xdc: {
                assert(mode <= 2);
                if (mode === 0) {
                    // data chunk index
                    assert(data[offs] === 0);
                    const behavior = data[offs + 1];
                    const scale = data[offs + 2]/256;
                    if (log) log(`emitter  bhv ${behavior} scale ${scale}`);
                    if (ctx) {
                        const particleData = assertExists(this.actor.particles).data.data;
                        ctx.state.fullEmitter = new Emitter(particleData.emitters[behavior], particleData);
                        ctx.state.fullEmitter.waitTimer = 0;
                        ctx.state.scale = scale;
                    }
                    return 4;
                }
            } break;
            case 0xDD: {
                const toCleanup = data[offs++];
                if (log) log(`update (cleanup: ${address(start, toCleanup)})`);
                if (ctx) {
                    const e = assertExists(ctx.state.fullEmitter);
                    if (e.waitTimer === EMITTER_DONE_TIMER) {
                        jump(ctx, toCleanup);
                        return 2;
                    }
                    const particles = assertExists(this.actor.particles);
                    vec3.copy(e.pos, ctx.state.pos);
                    const scale = ctx.state.scale * ctx.state.vecs[0][3]/256;
                    vec3.scale(e.scale, particles.emitters[e.spec.behavior].scale, scale);
                    e.euler[1] = (0x400 - ctx.state.vecs[0][1]) * Math.PI/0x800;
                }
                return 2;
            }
            case 0xDE: if (log) log(`cleanup`); return 1;
            case 0xE0: {
                const index = (base >>> 9) & 7;
                const parts = vecParts(mode);
                const scale = index < 2 ? 0x100 : index < 4 ? 1 : 1/0x10;
                let vals: number[] = [];
                for (let i = 0; i < parts.length; i++) {
                    vals.push(data[offs++]*scale);
                }
                if (log) log(`vec[${index}].${parts} = (${vals.toString()})${base & 0x200 ? ', f()' : ''}`);
                return offs - start;
            } break;
            case 0xF2: {
                if (mode === 1) {
                    if (log) log(`back to default vec op`);
                    if (ctx) {
                        ctx.state.vecOp = VecOp.DEFAULT;
                        for (let i = 0; i < 3; i++)
                            ctx.state.vecs[1][i] = 16*ctx.state.pos[i];
                        ctx.state.setPos = false;
                    }
                    return 2; // ?
                }
            } break;
            case 0xFF: {
                if (base * 0x400) {
                    if (log) log(`ident mtx`);
                    return 1;
                } else {
                    if (log) log(`mtx diag(${data[offs]/256},${data[offs+1]/256},${data[offs+2]/256})`);
                    return 4;
                }
            }
        }
        console.warn("unknown OP", op.toString(16), (base & 0xFFFF).toString(16));
        return -1;
    }

    public debug(index = 0) {
        console.log(this.entries.map(a=>a.toString(16)));

        const marked = new Map<number, basicParser>();
        while (index < this.data.length) {
            const parser = marked.get(index);
            if (parser) {
                console.log(`${hexzero(index, 4)}:`);
                index += parser(this.data, index, console.log);
                continue
            }
            const op = this.data[index] & 0xFFFF;
            const inc = this.processOp(index, undefined, (desc: string) => {
                console.log(`${hexzero(index, 4)}: ${hexzero(op, 4)}    ${desc}`);
            }, (start: number, parser: basicParser) => {
                marked.set(start, parser);
            });
            if (inc <= 0)
                break;
            index += inc;
        }
    }
}