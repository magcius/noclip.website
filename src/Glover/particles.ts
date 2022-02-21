import * as Textures from './textures';
import * as Viewer from '../viewer';

import { SRC_FRAME_TO_MS, CONVERT_FRAMERATE } from './timing';

import { mat4, vec3, vec4, quat } from 'gl-matrix';

import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { Color, colorNewFromRGBA } from "../Color";

import { GenericRenderable } from './render';
import { GloverWaterVolume } from './scenes';
import { GloverFlipbookRenderer } from './sprite';
import { GloverActorRenderer } from './actor';
import { pushAlongLookatVector } from './util';

const identityRotation: quat = quat.create();

export var framesets = {
    "smoke": [0xfd05d6ed],
    "smk": [0xb7726c76, 0x6c65c4e1, 0x2568a36c, 0xde8b8878, 0x9786eff5, 0x4c914762, 0x59c20ef],
    "plat": [0xf81cb1f1, 0x230b1966, 0x6a067eeb, 0x91e555ff],
    "ai_spl": [0xf513cd8b],
    "bstar": [0x799286aa, 0xa2852e3d, 0xeb8849b0, 0x106b62a4, 0x59660529, 0x8271adbe, 0xcb7cca33, 0x7176e621, 0x387b81ac],
    "glow": [0x81deafd3, 0x5ac90744, 0x13c460c9, 0xe8274bdd, 0xa12a2c50, 0x7a3d84c7, 0x3330e34a, 0x893acf58, 0xc037a8d5],
    "newisp": [0x9ac08ddd, 0x41d7254a, 0x8da42c7, 0xf33969d3, 0xba340e5e, 0x6123a6c9, 0x282ec144],
    "photon": [0xb3ff6811, 0x68e8c086, 0x21e5a70b],
    "sfair": [0x7d63d080, 0xa6747817, 0xef791f9a, 0x149a348e],
    "fardus": [0x7029ff33, 0xab3e57a4, 0xe2333029, 0x19d01b3d, 0x50dd7cb0],
    "score": [0xc651e2bd, 0x1d464a2a, 0x544b2da7, 0xafa806b3, 0xe6a5613e, 0x3db2c9a9],
    "fardus.4": [0x7029ff33, 0xab3e57a4, 0xe2333029, 0x19d01b3d],
    "acard00": [0xf12d36e0, 0x2a3a9e77, 0x6337f9fa, 0x98d4d2ee, 0xd1d9b563, 0xace1df4, 0x43c37a79, 0xf9c9566b, 0xb0c431e6, 0xa3085c15, 0xea053b98, 0x3112930f, 0x781ff482],
    "ballg2": [],
    "popa": [0x8c1c0bc3],
    "popb": [0x5de5b3f0],
    "egg": [0xa3dc132e, 0x78cbbbb9, 0x31c6dc34, 0xca25f720, 0x832890ad, 0x583f383a],
    "tear": [0x28accf81],
    "p": [0xac206169, 0x7737c9fe, 0x3e3aae73, 0xc5d98567, 0x8cd4e2ea, 0x57c34a7d],
    "marble": [0x1b13811, 0xdaa69086, 0x93abf70b, 0x6848dc1f, 0x2145bb92, 0xfa521305, 0xb35f7488, 0x955589a],
    "firea": [0xd74c9bc4],
    "fireb": [0x6b523f7, 0xdda28b60, 0x94afeced, 0x6f4cc7f9, 0x2641a074, 0xfd5608e3, 0xb45b6f6e, 0xe51437c],
    "splat": [0x96fc4a3e, 0x4debe2a9, 0x4e68524],
    "heart": [0xb5076649],
    "star": [0x4c5939d6],
    "balls": [0x6f4b2f89],
    "bubble": [0x4fb298c7],
    "glob": [0x11678dfd, 0xca70256a, 0x837d42e7, 0x789e69f3, 0x31930e7e, 0xea84a6e9, 0xa389c164, 0x1983ed76],
    "eolgb": [0x26436bf, 0xd9739e28, 0x907ef9a5, 0x6b9dd2b1, 0x2290b53c, 0xf9871dab, 0xb08a7a26, 0xa805634, 0x438d31b9, 0x50415c4a, 0x194c3bc7, 0xc25b9350],
    "eolcl": [0xbc294e17, 0x673ee680, 0x2e33810d, 0xd5d0aa19, 0x9cddcd94, 0x47ca6503, 0xec7028e, 0xb4cd2e9c, 0xfdc04911, 0xee0c24e2, 0xa701436f, 0x7c16ebf8, 0x351b8c75, 0xcef8a761, 0x87f5c0ec, 0x5ce2687b, 0x15ef0ff6, 0xafe523e4, 0xe6e84469, 0xc374336a],
    "trop00": [0x8b8186f, 0xd3afb0f8, 0x9aa2d775, 0x6141fc61, 0x284c9bec, 0xf35b337b, 0xba5654f6, 0x5c78e4, 0x49511f69, 0x5a9d729a, 0x13901517, 0xc887bd80, 0x818ada0d, 0x7a69f119, 0x33649694, 0xe8733e03],
    "puff": [0x62632f50],
    "cross": [0xd1a52c98],
    "horn00": [0x3416f4eb, 0xef015c7c, 0xa60c3bf1, 0x5def10e5, 0x14e27768, 0xcff5dfff, 0x86f8b872, 0x3cf29460, 0x75fff3ed, 0x66339e1e, 0x2f3ef993, 0xf4295104, 0xbd243689, 0x46c71d9d, 0xfca7a10, 0xd4ddd287, 0x9dd0b50a, 0x27da9918, 0x6ed7fe95],
    "note00": [0xb682b95c, 0x6d9511cb, 0x24987646, 0xdf7b5d52, 0x96763adf, 0x4d619248, 0x46cf5c5, 0xbe66d9d7, 0xf76bbe5a, 0xe4a7d3a9, 0xadaab424, 0x76bd1cb3, 0x3fb07b3e, 0xc453502a, 0x8d5e37a7, 0x56499f30, 0x1f44f8bd, 0xa54ed4af, 0xec43b322, 0xc9dfc421],
    "ohno": [0x9df40596],
    "rgarib": [0x217428c7, 0xfa638050],
    "traj": [0x7223342a]
}

export enum FlipbookType {
    Looping = 1,
    Oneshot = 2,
    MirrorLooping = 3, // TODO
    RandomStartLooping = 4,
    OnlyTweened = 5, // TODO
    OneshotBackwards = 6, // TODO
    NotTweened = 7 // TODO
}

export interface Flipbook {
    frameset: number[],
    frameDelay: number,
    type: FlipbookType,
    startAlpha: number,
    endAlpha: number,
    startSize: number,
    endSize: number,
    flags: number
}

export var collectibleFlipbooks = [
    {
        frameset: framesets["acard00"],
        frameDelay: 0,
        type: FlipbookType.RandomStartLooping,
        startAlpha: 0x96,
        endAlpha: 0x96,
        startSize: 0x40,
        endSize: 0x40,
        flags: 0
    },
    {
        frameset: framesets["ohno"],
        frameDelay: 0,
        type: FlipbookType.RandomStartLooping,
        startAlpha: 0xFF,
        endAlpha: 0xFF,
        startSize: 0x40,
        endSize: 0x40,
        flags: 0
    },
    {
        frameset: framesets["marble"],
        frameDelay: 0,
        type: FlipbookType.RandomStartLooping,
        startAlpha: 0xFF,
        endAlpha: 0xFF,
        startSize: 0x40,
        endSize: 0x40,
        flags: 0
    },
    {
        frameset: framesets["rgarib"],
        frameDelay: 0x20,
        type: FlipbookType.RandomStartLooping,
        startAlpha: 0x96,
        endAlpha: 0x96,
        startSize: 0x40,
        endSize: 0x40,
        flags: 0
    }
]

export var particleFlipbooks: Flipbook[] = [
    { // 0
        frameset: framesets["smoke"],
        frameDelay: 0x0,
        type: 0x5,
        startAlpha: 0xa0,
        endAlpha: 0x10,
        startSize: 0x20,
        endSize: 0x40,
        flags: 0x10000,
    },
    { // 1
        frameset: framesets["smk"],
        frameDelay: 0x20,
        type: 0x2,
        startAlpha: 0xa0,
        endAlpha: 0x20,
        startSize: 0x60,
        endSize: 0x60,
        flags: 0x10000,
    },
    { // 2
        frameset: framesets["plat"],
        frameDelay: 0x0,
        type: 0x1,
        startAlpha: 0x80,
        endAlpha: 0x80,
        startSize: 0x20,
        endSize: 0x20,
        flags: 0x0,
    },
    { // 3
        frameset: framesets["ai_spl"],
        frameDelay: 0x0,
        type: 0x5,
        startAlpha: 0xf8,
        endAlpha: 0x20,
        startSize: 0x36,
        endSize: 0x20,
        flags: 0x10000,
    },
    { // 4
        frameset: [],
        frameDelay: 0x0,
        type: 0x0,
        startAlpha: 0x0,
        endAlpha: 0x0,
        startSize: 0x0,
        endSize: 0x0,
        flags: 0x0
    },
    { // 5
        frameset: framesets["bstar"],
        frameDelay: 0x0,
        type: 0x2,
        startAlpha: 0xff,
        endAlpha: 0x32,
        startSize: 0x60,
        endSize: 0x60,
        flags: 0x10000,
    },
    { // 6
        frameset: framesets["glow"],
        frameDelay: 0x10,
        type: 0x1,
        startAlpha: 0xff,
        endAlpha: 0x32,
        startSize: 0x60,
        endSize: 0x60,
        flags: 0x10000,
    },
    { // 7
        frameset: framesets["newisp"],
        frameDelay: 0x10,
        type: 0x2,
        startAlpha: 0xff,
        endAlpha: 0xff,
        startSize: 0x40,
        endSize: 0x40,
        flags: 0x10000,
    },
    { // 8
        frameset: framesets["photon"],
        frameDelay: 0x0,
        type: 0x4,
        startAlpha: 0xff,
        endAlpha: 0x80,
        startSize: 0x50,
        endSize: 0x20,
        flags: 0x10000,
    },
    { // 9
        frameset: framesets["sfair"],
        frameDelay: 0x0,
        type: 0x3,
        startAlpha: 0xff,
        endAlpha: 0x1e,
        startSize: 0x80,
        endSize: 0x80,
        flags: 0x10000,
    },
    { // 10
        frameset: framesets["fardus"],
        frameDelay: 0x20,
        type: 0x2,
        startAlpha: 0xc8,
        endAlpha: 0x64,
        startSize: 0x70,
        endSize: 0x70,
        flags: 0x10000,
        // frameDelay: 0x10,
        // type: 0x2,
        // startAlpha: 0xff,
        // endAlpha: 0xff,
        // startSize: 0x40,
        // endSize: 0x40,
        // flags: 0x10000,
    },
    { // 11
        frameset: framesets["fardus.4"],
        frameDelay: 0x0,
        type: 0x2,
        startAlpha: 0xff,
        endAlpha: 0xff,
        startSize: 0x60,
        endSize: 0x60,
        flags: 0x10000,
    },
    { // 12
        frameset: framesets["sfair"],
        frameDelay: 0x0,
        type: 0x5,
        startAlpha: 0xff,
        endAlpha: 0x64,
        startSize: 0x80,
        endSize: 0x40,
        flags: 0x10000,
    },
    { // 13
        frameset: framesets["traj"],
        frameDelay: 0x0,
        type: 0x7,
        startAlpha: 0x80,
        endAlpha: 0x80,
        startSize: 0x20,
        endSize: 0x20,
        flags: 0x10000,
    },
    { // 14
        frameset: framesets["popa"],
        frameDelay: 0x0,
        type: 0x5,
        startAlpha: 0xff,
        endAlpha: 0xff,
        startSize: 0x40,
        endSize: 0x64,
        flags: 0x0,
    },
    { // 15
        frameset: framesets["popb"],
        frameDelay: 0x0,
        type: 0x5,
        startAlpha: 0xff,
        endAlpha: 0x0,
        startSize: 0x2,
        endSize: 0xc8,
        flags: 0x10000,
    },
    { // 16
        frameset: framesets["p"],
        frameDelay: 0x0,
        type: 0x4,
        startAlpha: 0xff,
        endAlpha: 0xff,
        startSize: 0x40,
        endSize: 0x40,
        flags: 0x10000,
    },
    { // 17
        frameset: framesets["splat"],
        frameDelay: 0x10,
        type: 0x2,
        startAlpha: 0xff,
        endAlpha: 0xff,
        startSize: 0x40,
        endSize: 0x40,
        flags: 0x0,
    },
    { // 18
        frameset: framesets["heart"],
        frameDelay: 0x10,
        type: 0x5,
        startAlpha: 0xff,
        endAlpha: 0x0,
        startSize: 0x40,
        endSize: 0x80,
        flags: 0x10000,
    },
    { // 19
        frameset: framesets["star"],
        frameDelay: 0x0,
        type: 0x5,
        startAlpha: 0xff,
        endAlpha: 0x0,
        startSize: 0x40,
        endSize: 0x10,
        flags: 0x10000,
    },
    { // 20
        frameset: framesets["bubble"],
        frameDelay: 0x0,
        type: 0x0,
        startAlpha: 0x9b,
        endAlpha: 0x9b,
        startSize: 0x20,
        endSize: 0x20,
        flags: 0x10000,
    },
    { // 21
        frameset: framesets["puff"],
        frameDelay: 0x0,
        type: 0x5,
        startAlpha: 0xff,
        endAlpha: 0x0,
        startSize: 0x30,
        endSize: 0x0,
        flags: 0x10000,
    },
    { // 22
        frameset: framesets["traj"],
        frameDelay: 0x0,
        type: 0x5,
        startAlpha: 0xff,
        endAlpha: 0x0,
        startSize: 0x20,
        endSize: 0x20,
        flags: 0x10000,
    },
    { // 23
        frameset: framesets["score"],
        frameDelay: 0x0,
        type: 0x5,
        startAlpha: 0xff,
        endAlpha: 0x0,
        startSize: 0x40,
        endSize: 0x40,
        flags: 0x10000,
    }
]

export interface ParticleParams {
    actorFlags: number;
    lifetimeMin: number;
    lifetimeJitter: number;
    bboxHeight: number;
    friction: number;
    childParticleType: number;
}

export var particleParameters: ParticleParams[] = [
    { // 0
        actorFlags: 0, // smoke
        lifetimeMin: 20,
        lifetimeJitter: 0,
        bboxHeight: 5,
        friction: 0.70,
        childParticleType: 24
    },
    { // 1
        actorFlags: 0, // smk
        lifetimeMin: 0,
        lifetimeJitter: 0,
        bboxHeight: 5,
        friction: 0.90,
        childParticleType: 24
    },
    { // 2
        actorFlags: 0x1, // plat
        lifetimeMin: 20,
        lifetimeJitter: 0,
        bboxHeight: 5,
        friction: 0.80,
        childParticleType: 24
    },
    { // 3
        actorFlags: 0x1, // ai_spl
        lifetimeMin: 20,
        lifetimeJitter: 0,
        bboxHeight: 5,
        friction: 0.80,
        childParticleType: 24
    },
    { // 4
        actorFlags: 0x1, // ???
        lifetimeMin: 13,
        lifetimeJitter: 6,
        bboxHeight: 5,
        friction: 0.87,
        childParticleType: 24
    },
    { // 5
        actorFlags: 0x800000, // bstar
        lifetimeMin: 0,
        lifetimeJitter: 0,
        bboxHeight: 5,
        friction: 0.70,
        childParticleType: 24
    },
    { // 6
        actorFlags: 0, // glow
        lifetimeMin: 30,
        lifetimeJitter: 8,
        bboxHeight: 5,
        friction: 0.70,
        childParticleType: 24
    },
    { // 7
        actorFlags: 0, // newisp
        lifetimeMin: 18,
        lifetimeJitter: 8,
        bboxHeight: 5,
        friction: 1,
        childParticleType: 24
    },
    { // 8
        actorFlags: 0x40000091, // photon
        lifetimeMin: 30,
        lifetimeJitter: 10,
        bboxHeight: 7,
        friction: 0.80,
        childParticleType: 5
    },
    { // 9/
        actorFlags: 0, // sfair
        lifetimeMin: 12,
        lifetimeJitter: 0,
        bboxHeight: 5,
        friction: 0.80,
        childParticleType: 24
    },
    { // 10
        actorFlags: 0, // fardus
        lifetimeMin: 0,
        lifetimeJitter: 0,
        bboxHeight: 5,
        friction: 0.80,
        childParticleType: 24
    },
    { // 11
        actorFlags: 0, // fardus
        lifetimeMin: 0,
        lifetimeJitter: 0,
        bboxHeight: 5,
        friction: 0.80,
        childParticleType: 24
    },
    { // 12
        actorFlags: 0x800000, // sfair
        lifetimeMin: 6,
        lifetimeJitter: 0,
        bboxHeight: 5,
        friction: 1,
        childParticleType: 24
    },
    { // 13
        actorFlags: 0x40000010, // traj
        lifetimeMin: 60,
        lifetimeJitter: 0,
        bboxHeight: 5,
        friction: 1,
        childParticleType: 5
    },
    { // 14
        actorFlags: 0, // popa
        lifetimeMin: 3,
        lifetimeJitter: 0,
        bboxHeight: 0,
        friction: 1,
        childParticleType: 24
    },
    { // 15
        actorFlags: 0, // popb
        lifetimeMin: 4,
        lifetimeJitter: 0,
        bboxHeight: 0,
        friction: 1,
        childParticleType: 24
    },
    { // 16
        actorFlags: 0x1000000, // p
        lifetimeMin: 20,
        lifetimeJitter: 0,
        bboxHeight: 0,
        friction: 1,
        childParticleType: 24
    },
    { // 17
        actorFlags: 0x800000, // splat
        lifetimeMin: 0,
        lifetimeJitter: 0,
        bboxHeight: 0,
        friction: 0,
        childParticleType: 24
    },
    { // 18
        actorFlags: 0, // heart
        lifetimeMin: 14,
        lifetimeJitter: 10,
        bboxHeight: 0,
        friction: 0.80,
        childParticleType: 24
    },
    { // 19
        actorFlags: 0x800000, // star
        lifetimeMin: 8,
        lifetimeJitter: 0,
        bboxHeight: 0,
        friction: 0,
        childParticleType: 24
    },
    { // 20
        actorFlags: 0, // bubble
        lifetimeMin: 1000,
        lifetimeJitter: 5,
        bboxHeight: 0,
        friction: 1,
        childParticleType: 24
    },
    { // 21
        actorFlags: 0, // puff
        lifetimeMin: 10,
        lifetimeJitter: 5,
        bboxHeight: 0,
        friction: 0.70,
        childParticleType: 24
    },
    { // 22
        actorFlags: 0, // traj
        lifetimeMin: 12,
        lifetimeJitter: 0,
        bboxHeight: 5,
        friction: 0.80,
        childParticleType: 24
    },
    { // 23
        actorFlags: 0, // score
        lifetimeMin: 40,
        lifetimeJitter: 0,
        bboxHeight: 5,
        friction: 1,
        childParticleType: 24
    }
]

export class Particle {
    public active: boolean = true;

    public flipbook: GloverFlipbookRenderer;

    private lastPosition: vec3 = vec3.create();
    private nextPosition: vec3 = vec3.create();

    private position: vec3 = vec3.create();
    private velocity: vec3 = vec3.create();

    public scale: vec3 = vec3.create();

    private lastFrameAdvance: number = 0;
    private frameCount: number = 0;
    private lifetime: number = 0;

    constructor (device: GfxDevice, cache: GfxRenderCache, textureHolder: Textures.GloverTextureHolder, private particleType: number, private waterVolumes: GloverWaterVolume[] = []) {
        this.flipbook = new GloverFlipbookRenderer(
            device, cache, textureHolder, particleFlipbooks[particleType]);
    } 

    public spawn(origin: vec3 | number[], velocity: vec3 | number[]) {
        const params = particleParameters[this.particleType];
        this.nextPosition = vec3.fromValues(origin[0], origin[1], origin[2]);
        vec3.copy(this.lastPosition, this.nextPosition);
        this.velocity = vec3.fromValues(velocity[0], velocity[1], velocity[2]);
        this.active = true;
        this.flipbook.reset();
        this.setLifetime(params.lifetimeMin + Math.floor(Math.random() * params.lifetimeJitter))
        this.frameCount = 0;
        this.scale = vec3.fromValues(1, 1, 1);
    }

    private advanceWaterParticle() {
        const wobble = Math.sin((this.lifetime*6)/10);
        vec3.set(this.scale,
            (32 + wobble * 7)/(3*8),
            (32 - wobble * 7)/(3*8),
            1
        );
        if (Math.floor(Math.random()*3) === 1) {
            this.velocity[0] *= 0.5;
            this.velocity[2] *= 0.5;
            this.velocity[0] += Math.cos(-this.frameCount) * 0.7;
            this.velocity[2] += Math.sin(-this.frameCount) * 0.7;
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const params = particleParameters[this.particleType];


        // TODO: look into default particle physics parameters as set by
        //       initParticleSystem(), around address 0x801b6570

        
        if (this.lastFrameAdvance >= SRC_FRAME_TO_MS) {
            vec3.copy(this.lastPosition, this.nextPosition);

            this.lastFrameAdvance = 0;
            this.frameCount += 1;
            this.lifetime -= 1;

            vec3.add(this.nextPosition, this.nextPosition, this.velocity);
            vec3.scale(this.velocity, this.velocity, params.friction);

            if ((params.actorFlags & 1) !== 0) {
                const gravAccel = (params.actorFlags & 0x40) == 0 ? 1.2 : 0.6;
                const terminalVelocity = (params.actorFlags & 0x1000000) == 0 ? -15 : -100000;
                this.velocity[1] = Math.max(this.velocity[1] - gravAccel, terminalVelocity);
            }

            if (this.particleType === 0x14) {
                this.advanceWaterParticle();
            }
        } else {
            this.lastFrameAdvance += viewerInput.deltaTime;
        }

        vec3.lerp(this.position, this.lastPosition, this.nextPosition, Math.min(1.0, this.lastFrameAdvance/(SRC_FRAME_TO_MS*1.1)));
        
        if (this.waterVolumes.length > 0) {
            for (let waterVolume of this.waterVolumes) {
                if (waterVolume.inBbox(this.lastPosition) && this.position[1] >= waterVolume.surface_y) {
                    if (this.particleType === 0x14) {
                        waterVolume.surfaceRipple(this.position, this.velocity);
                    }
                    this.active = false;
                    return;
                }
            }
        }

        mat4.fromRotationTranslationScale(this.flipbook.drawMatrix, identityRotation, this.position, this.scale);

        this.flipbook.prepareToRender(device, renderInstManager, viewerInput);
        if (!this.flipbook.playing) {
            this.active = false;
        }
    }

    public setLifetime(frames: number): void {
        this.flipbook.setLifetime(frames * SRC_FRAME_TO_MS);
        this.lifetime = frames;
    }

    public destroy(device: GfxDevice): void {
        this.flipbook.destroy(device);
    }
}

export class ParticlePool implements GenericRenderable {
    private particles: Particle[] = [];

    public visible: boolean = true;

    constructor (private device: GfxDevice, private cache: GfxRenderCache, private textureHolder: Textures.GloverTextureHolder, private particleType: number, private waterVolumes: GloverWaterVolume[] = []) {
    }

    public spawn(origin: vec3 | number[], velocity: vec3 | number[]): Particle {
        let newParticle = null;
        for (let particle of this.particles) {
            if (!particle.active) {
                newParticle = particle;
                break;
            }
        }
        if (newParticle === null) {
            newParticle = new Particle(this.device, this.cache, this.textureHolder, this.particleType, this.waterVolumes);
            this.particles.push(newParticle);
        }
        newParticle.spawn(origin, velocity);
        return newParticle
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible) {
            return;
        }
        for (let particle of this.particles) {
            if (particle.active) {
                particle.prepareToRender(device, renderInstManager, viewerInput);
            }
        }
    }

    public destroy(device: GfxDevice): void {
        for (let particle of this.particles) {
            particle.destroy(device)
        }
    }
}

const exitParticleColors: number[][] = [
    [0xfd, 0xad, 0x29],
    [0xff, 0xd2, 0x05],
    [0xfe, 0x8d, 0x1e],
    [0xfb, 0xe3, 0x15],
    [0xff, 0x6a, 0x11],
]


export function spawnExitParticle(particles: ParticlePool, origin: vec3 | number[], velocity: vec3 | number[], scale: number): Particle {
    const particle = particles.spawn(origin, velocity);
    const color = exitParticleColors[Math.floor(Math.random() * exitParticleColors.length)];
    particle.flipbook.startSize *= scale;
    particle.flipbook.endSize *= scale;
    particle.flipbook.setPrimColor(color[0], color[1], color[2]);
    return particle;
}

export class MeshSparkle implements GenericRenderable {
    private particles: ParticlePool;

    private lastFrameAdvance: number = 0;
    private frameCount: number = 0;

    private static velocity = [0,0,0];

    private static positionScratch1 = vec3.create();
    private static positionScratch2 = vec3.create();

    private geo: GloverObjbank.Geometry;

    public visible: boolean = true;

    constructor(device: GfxDevice, cache: GfxRenderCache, textureHolder: Textures.GloverTextureHolder, private actor: GloverActorRenderer, private period: number, waterVolumes: GloverWaterVolume[]) {
        this.geo = actor.rootMesh.mesh.geometry;
        this.particles = new ParticlePool(device, cache, textureHolder, 10, waterVolumes);
    }

    public destroy(device: GfxDevice): void {
        this.particles.destroy(device);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        this.lastFrameAdvance += viewerInput.deltaTime;
        if (this.lastFrameAdvance > 50) {
            this.lastFrameAdvance = 0;
            this.frameCount += 1;

            if (this.frameCount >= this.period) {
                this.frameCount = 0;
                const face = this.geo.faces[Math.floor(Math.random()*this.geo.numFaces)];
                const vertRnd = Math.floor(Math.random()*3);
                const vertIdx = vertRnd == 0 ? face.v0 : vertRnd == 1 ? face.v1 : face.v2;
                const vert = this.geo.vertices[vertIdx];
                
                const origin = MeshSparkle.positionScratch1;
                const lookat = MeshSparkle.positionScratch2;
                vec3.set(origin, vert.x, vert.y, vert.z);
                vec3.transformMat4(origin, origin, this.actor.modelMatrix)
                pushAlongLookatVector(origin, origin, -6, viewerInput);

                const particle = this.particles.spawn(origin, MeshSparkle.velocity);
                particle.setLifetime(-1);
                // TODO: particle->flipbookFrameDuration = 0; ???
            }

        }

        if (!this.visible) {
            return;
        }
        this.particles.prepareToRender(device, renderInstManager, viewerInput);
    }

}
