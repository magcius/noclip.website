
// particle

import { mat4, ReadonlyMat4, ReadonlyVec3, vec2, vec3 } from "gl-matrix";
import { Color, colorCopy, colorNewCopy } from "../Color.js";
import { JPABaseEmitter, JPAEmitterManager, JPAResourceData, JPAEmitterCallBack, JPADrawInfo, JPACData, JPAC, JPAResourceRaw } from "../Common/JSYSTEM/JPA.js";
import { Frustum } from "../Geometry.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { EFB_HEIGHT, EFB_WIDTH } from "../gx/gx_material.js";
import { computeModelMatrixR, getMatrixTranslation, saturate, transformVec3Mat4w0 } from "../MathHelpers.js";
import { TDDraw } from "../SuperMarioGalaxy/DDraw.js";
import { TextureMapping } from "../TextureHolder.js";
import { assert, nArray } from "../util.js";
import { ViewerRenderInput } from "../viewer.js";
import { dKy_get_seacolor } from "./d_kankyo.js";
import { cLib_addCalc2, cM_s2rad } from "./SComponent.js";
import { dGlobals } from "./Main.js";
import * as GX from '../gx/gx_enum.js';
import { ColorKind } from "../gx/gx_render.js";
import { gfxDeviceNeedsFlipY } from "../gfx/helpers/GfxDeviceHelpers.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";

// Simple common particles
const j_o_id: number[] = [ 0x0000, 0x0001, 0x0002, 0x0003, 0x03DA, 0x03DB, 0x03DC, 0x4004 ];

// Simple scene particles
const s_o_id: number[] = [
    0x8058, 0x8059, 0x805A, 0x805B, 0x805C, 0x8221, 0x8222, 0x8060, 0x8061, 0x8062, 0x8063, 0x8064, 0x8065, 0x8066, 
    0x8067, 0x8068, 0x8069, 0x81D5, 0x8240, 0x8241, 0x8306, 0x8407, 0x8408, 0x8409, 0x8443, 0x840A, 0x840B, 0x840C,
    0x840D, 0x840E, 0x840F, 0xA410, 0xA06A, 0xC06B,
];

export abstract class dPa_levelEcallBack extends JPAEmitterCallBack {
    constructor(protected globals: dGlobals) {
        super();
    }

    public setup(emitter: JPABaseEmitter, pos: ReadonlyVec3 | null, rot: ReadonlyVec3 | null, setupInfo: number): void {
    }
}

export const enum ParticleGroup {
    Normal,
    NormalP1,
    Toon,
    ToonP1,
    Projection,
    ShipTail,
    Wind,
    TwoDfore,
    TwoDback,
    TwoDmenuFore,
    TwoDmenuBack,
}

function setTextureMappingIndirect(m: TextureMapping, flipY: boolean): void {
    m.width = EFB_WIDTH;
    m.height = EFB_HEIGHT;
    m.flipY = flipY;
    m.lateBinding = 'OpaqueSceneTexture';
}

export class dPa_control_c {
    private emitterManager: JPAEmitterManager;
    private drawInfo = new JPADrawInfo();
    private jpacData: JPACData[] = [];
    private resourceDatas = new Map<number, JPAResourceData>();
    private flipY: boolean;
    private simpleCallbacks: dPa_simpleEcallBack[] = [];

    constructor(cache: GfxRenderCache) {
        const device = cache.device;
        this.flipY = gfxDeviceNeedsFlipY(device);
        this.emitterManager = new JPAEmitterManager(cache, 6000, 300);
    }

    public createCommon(globals: dGlobals, commonJpac: JPAC): void {
        const jpacData = new JPACData(commonJpac);
        const m = jpacData.getTextureMappingReference('AK_kagerouSwap00');
        if (m !== null)
            setTextureMappingIndirect(m, this.flipY);
        this.jpacData.push(jpacData);

        for (let id of j_o_id) {
            const resData = this.getResData(globals, id);
            if (resData) {
                this.newSimple(resData, id, id & 0x4000 ? ParticleGroup.Projection : ParticleGroup.Normal)
            }
        }
    }

    public createRoomScene(globals: dGlobals, sceneJpac: JPAC): void {
        const jpacData = new JPACData(sceneJpac);
        const m = jpacData.getTextureMappingReference('AK_kagerouSwap00');
        if (m !== null)
            setTextureMappingIndirect(m, this.flipY);
        this.jpacData.push(jpacData);

        for (let id of s_o_id) {
            const resData = this.getResData(globals, id);
            if (resData) {
                let groupID;
                if (id & 0x4000) groupID = ParticleGroup.Projection;
                else if (id & 0x2000) groupID = ParticleGroup.Toon;
                else groupID = ParticleGroup.Normal;
                this.newSimple(resData, id, groupID)
            }
        }
    }

    private newSimple(resData: JPAResourceData, userID: number, groupID: number): void {
        const simple = new dPa_simpleEcallBack();
        simple.create(this.emitterManager, resData, userID, groupID);
        this.simpleCallbacks.push(simple);
    }

    public setDrawInfo(posCamMtx: ReadonlyMat4, prjMtx: ReadonlyMat4, texPrjMtx: ReadonlyMat4 | null, frustum: Frustum | null): void {
        this.drawInfo.posCamMtx = posCamMtx;
        this.drawInfo.texPrjMtx = texPrjMtx;
        this.drawInfo.frustum = frustum;
    }

    public calc(globals: dGlobals, viewerInput: ViewerRenderInput): void {
        const inc = viewerInput.deltaTime / 1000 * 30;

        // Some hacky distance culling for emitters.
        for (let i = 0; i < this.emitterManager.aliveEmitters.length; i++) {
            const emitter = this.emitterManager.aliveEmitters[i];

            // Don't distance cull 2D/UI emitters
            if (emitter.drawGroupId >= ParticleGroup.TwoDfore)
                continue;

            let cullDistance = (emitter as any).cullDistance;
            if (cullDistance === null)
                continue;

            cullDistance = cullDistance ?? 8000;
            if (vec3.distance(emitter.globalTranslation, globals.camera.cameraPos) > cullDistance) {
                emitter.stopCalcEmitter();
                emitter.stopDrawParticle();
            } else {
                emitter.playCalcEmitter();
                emitter.playDrawParticle();
            }
        }

        this.emitterManager.calc(inc);
    }

    public draw(device: GfxDevice, renderInstManager: GfxRenderInstManager, drawGroupId: number): void {
        this.emitterManager.draw(device, renderInstManager, this.drawInfo, drawGroupId);
    }

    private getRM_ID(userID: number): number {
        return userID >>> 15;
    }

    private findResData(userIndex: number): [JPACData, JPAResourceRaw] | null {
        for (let i = 0; i < this.jpacData.length; i++) {
            const r = this.jpacData[i].jpac.effects.find((resource) => resource.resourceId === userIndex);
            if (r !== undefined)
                return [this.jpacData[i], r];
        }

        return null;
    }

    private getResData(globals: dGlobals, userIndex: number): JPAResourceData | null {
        if (!this.resourceDatas.has(userIndex)) {
            const data = this.findResData(userIndex);
            if (data !== null) {
                const [jpacData, jpaResRaw] = data;
                const device = globals.modelCache.device, cache = globals.modelCache.cache;
                const resData = new JPAResourceData(device, cache, jpacData, jpaResRaw);
                this.resourceDatas.set(userIndex, resData);
            } else {
                return null;
            }
        }

        return this.resourceDatas.get(userIndex)!;
    }

    public set(globals: dGlobals, groupID: number, userID: number, pos: ReadonlyVec3 | null, rot: ReadonlyVec3 | null = null, scale: ReadonlyVec3 | null = null, alpha: number = 1.0, callBack: dPa_levelEcallBack | null = null, setupInfo: number = 0, colorPrm: Color | null = null, colorEnv: Color | null = null, publicScale2D: ReadonlyVec3 | null = null): JPABaseEmitter | null {
        const resData = this.getResData(globals, userID);
        if (resData === null)
            return null;

        const baseEmitter = this.emitterManager.createEmitter(resData);
        if (baseEmitter === null)
            return null;

        baseEmitter.drawGroupId = groupID;

        if (pos !== null)
            vec3.copy(baseEmitter.globalTranslation, pos);
        if (rot !== null)
            computeModelMatrixR(baseEmitter.globalRotation, cM_s2rad(rot[0]), cM_s2rad(rot[1]), cM_s2rad(rot[2]));
        if (scale !== null) {
            vec3.copy(baseEmitter.globalDynamicsScale, scale);
            vec2.set(baseEmitter.globalParticleScale, scale[0], scale[1]);
        }

        if (colorPrm !== null)
            colorCopy(baseEmitter.globalColorPrm, colorPrm);
        if (colorEnv !== null)
            colorCopy(baseEmitter.globalColorPrm, colorEnv);
        baseEmitter.globalColorPrm.a = alpha;

        if (callBack !== null) {
            baseEmitter.emitterCallBack = callBack;
            callBack.setup(baseEmitter, pos, rot, setupInfo);
        } else if (!!(userID & 0x4000)) {
            // kagerouE
        }

        if (publicScale2D !== null)
            vec2.set(baseEmitter.globalParticleScale, publicScale2D[0], publicScale2D[1]);

        return baseEmitter;
    }

    public setSimple(userID: number, pos: vec3, alpha: number, prmColor: Color, envColor: Color, isAffectedByWind: boolean): boolean {
        const simple = this.simpleCallbacks.find(s => s.userID == userID);
        if (!simple)
            return false;
        return simple.set(pos, alpha / 0xFF, prmColor, envColor, isAffectedByWind);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.jpacData.length; i++)
            this.jpacData[i].destroy(device);
        this.emitterManager.destroy(device);
    }
}

interface dPa_simpleData_c {
    pos: vec3;
    prmColor: Color;
    envColor: Color;
    isAffectedByWind: boolean;
};

class dPa_simpleEcallBack extends JPAEmitterCallBack {
    public userID: number;
    public groupID: number;
    private baseEmitter: JPABaseEmitter | null;
    private datas: dPa_simpleData_c[] = [];
    private emitCount: number = 0;

    public create(emitterManager: JPAEmitterManager, resData: JPAResourceData, userID: number, groupID: number) {
        this.userID = userID;
        this.groupID = groupID;
        this.baseEmitter = emitterManager.createEmitter(resData);
        if (this.baseEmitter) {
            this.baseEmitter.drawGroupId = groupID;
            this.baseEmitter.emitterCallBack = this;
            this.baseEmitter.maxFrame = 0;
            this.baseEmitter.stopCreateParticle();

            // From dPa_simpleEcallBack::draw(). Fixup TEV settings for particles that access the framebuffer.  
            if (groupID == ParticleGroup.Projection) {
                const m = resData.materialHelper.material;
                m.tevStages[0].alphaInA = GX.CA.ZERO;
                m.tevStages[0].alphaInB = GX.CA.ZERO;
                m.tevStages[0].alphaInC = GX.CA.ZERO;
                m.tevStages[0].alphaInD = GX.CA.A0;
                resData.materialHelper.materialInvalidated();
            }

            if (userID == 0xa06a || userID == 0xa410) {
                // TODO: Smoke callback
            }
        }
    }

    public set(pos: vec3, alpha: number, prmColor: Color, envColor: Color, isAffectedByWind: boolean): boolean {
        this.datas.push({ pos: vec3.clone(pos), prmColor: colorNewCopy(prmColor, alpha), envColor: colorNewCopy(envColor), isAffectedByWind });
        return true;
    }

    public override executeAfter(emitter: JPABaseEmitter): void {
        const workData = emitter.emitterManager.workData;
        if (workData.volumeEmitCount <= 0) {
            this.datas = [];
            return;
        }

        // The emit count is often 1 per game-frame, meaning our emit count will be ~0.5 
        // So we track the emit count across frames and only actually emit when it is >1
        this.emitCount += workData.volumeEmitCount * workData.deltaTime;
        const emitThisFrame = Math.floor(this.emitCount);
        this.emitCount -= emitThisFrame;

        emitter.playCreateParticle();
        for (let simple of this.datas) {
            if (!workData.frustum || workData.frustum.containsSphere(simple.pos, 200)) {
                emitter.setGlobalTranslation(simple.pos);
                colorCopy(emitter.globalColorPrm, simple.prmColor);
                colorCopy(emitter.globalColorEnv, simple.envColor);
                for (let i = 0; i < emitThisFrame; i++) {
                    const particle = emitter.createParticle();
                    if (!particle)
                        break;
                    
                    // NOTE: Overwriting this removes the influence of the local emitter translation (bem.emitterTrs)
                    //       I.e. all simple emitters ignore their local offsets and are fixed to the local origin.
                    vec3.copy(particle.offsetPosition, simple.pos);
                    if (simple.isAffectedByWind) {
                        // TODO: Wind callback
                    }
                }
            }
        }
        this.datas = [];
        emitter.stopCreateParticle();
    }
}

export class dPa_splashEcallBack extends dPa_levelEcallBack {
    public emitter: JPABaseEmitter | null = null;

    public scaleTimer = 0;
    public maxScaleTimer = 1;

    private state = -1;
    private pos: ReadonlyVec3;
    private rot: ReadonlyVec3;

    public override setup(emitter: JPABaseEmitter, pos: ReadonlyVec3, rot: ReadonlyVec3): void {
        this.emitter = emitter;
        this.state = 0;
        this.pos = pos;
        this.rot = rot;
    }

    public override execute(emitter: JPABaseEmitter): void {
        const deltaTimeFrames = emitter.emitterManager.workData.deltaTime;
        const globals = this.globals, envLight = globals.g_env_light;

        dKy_get_seacolor(envLight, emitter.globalColorPrm, null);
        if (this.state === 0) {
            vec3.copy(emitter.globalTranslation, this.pos);
            const scale = Math.min(this.scaleTimer / this.maxScaleTimer, 1.0);
            vec3.set(emitter.globalDynamicsScale, scale, scale, scale);
            vec2.set(emitter.globalParticleScale, scale, scale);
            emitter.directionalSpeed = 15.0 * scale;
            computeModelMatrixR(emitter.globalRotation, 0.0, cM_s2rad(this.rot[1]), 0.0);
        } else {
            const scale = emitter.globalParticleScale[0] - (0.2 * deltaTimeFrames);
            if (scale <= 0.0) {
                this.remove();
            } else {
                vec3.set(emitter.globalDynamicsScale, scale, scale, scale);
                vec2.set(emitter.globalParticleScale, scale, scale);
                emitter.directionalSpeed = 15.0 * scale;
            }
        }
    }

    public remove(): void {
        if (this.emitter === null)
            return;

        this.emitter.emitterCallBack = null;
        this.emitter.becomeInvalidEmitterImmediate();
        this.emitter = null;
    }
}

const scratchVec3a = vec3.create();
export class dPa_waveEcallBack extends dPa_levelEcallBack {
    public emitter: JPABaseEmitter | null = null;
    public fadeTimer = 0.0;
    public vel = 0.0;
    public velFade1 = 1.0;
    public velFade2 = 1.0;
    public velSpeed = 1.0;
    public maxParticleVelocity = 10000.0;
    public collapsePos = nArray(2, () => vec3.create());

    private state = -1;
    private pos: ReadonlyVec3;
    private rot: ReadonlyVec3;
    private rotMtx = mat4.create();

    private ddraw = new TDDraw();

    constructor(protected override globals: dGlobals) {
        super(globals);

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
    }

    public override setup(emitter: JPABaseEmitter, pos: ReadonlyVec3, rot: ReadonlyVec3): void {
        this.emitter = emitter;
        this.state = 0;
        this.pos = pos;
        this.rot = rot;
        this.vel = 0.0;
        this.velFade2 = 1.0;
        this.maxParticleVelocity = 10000.0;
    }

    public override draw(emitter: JPABaseEmitter, device: GfxDevice, renderInstManager: GfxRenderInstManager): void {
        if (emitter.aliveParticlesBase.length < 2)
            return;

        const workData = emitter.emitterManager.workData;
        const ddraw = this.ddraw;
        ddraw.beginDraw(renderInstManager.gfxRenderCache);

        const vertsPerFan = (emitter.aliveParticlesBase.length + 1);
        ddraw.allocPrimitives(GX.Command.DRAW_TRIANGLE_FAN, vertsPerFan * this.collapsePos.length);

        for (let i = 0; i < this.collapsePos.length; i++) {
            const collapsePos = this.collapsePos[i];
            transformVec3Mat4w0(scratchVec3a, this.rotMtx, collapsePos);
            vec3.add(scratchVec3a, emitter.globalTranslation, scratchVec3a);

            ddraw.begin(GX.Command.DRAW_TRIANGLE_FAN, vertsPerFan);
            ddraw.position3vec3(scratchVec3a);
            ddraw.texCoord2f32(GX.Attr.TEX0, 0.5, 0.0);

            for (let j = 0; j < emitter.aliveParticlesBase.length; j++) {
                ddraw.position3vec3(emitter.aliveParticlesBase[j].position);
                const texS = j / (emitter.aliveParticlesBase.length - 1);
                ddraw.texCoord2f32(GX.Attr.TEX0, texS, 1.0);
            }

            ddraw.end();
        }

        const renderInst = ddraw.endDrawAndMakeRenderInst(renderInstManager);
        renderInst.sortKey = workData.particleSortKey;
        dKy_get_seacolor(this.globals.g_env_light, workData.materialParams.u_Color[ColorKind.C0], workData.materialParams.u_Color[ColorKind.C1]);
        workData.fillParticleRenderInst(device, renderInstManager, renderInst);
        renderInstManager.submitRenderInst(renderInst);
    }

    public override executeAfter(emitter: JPABaseEmitter): void {
        const workData = emitter.emitterManager.workData;
        mat4.copy(this.rotMtx, workData.emitterGlobalRotation);

        if (workData.deltaTime < 0.01)
            return;

        if (this.state === 0) {
            computeModelMatrixR(emitter.globalRotation, 0.0, cM_s2rad(this.rot[1]), 0.0);

            const vel = Math.min(vec3.distance(emitter.globalTranslation, this.pos) / workData.deltaTime, this.maxParticleVelocity);
            let velTarget = vel * this.velFade1 * this.velFade2;

            this.vel = cLib_addCalc2(this.vel, velTarget, 1.0, this.velSpeed);
            emitter.directionalSpeed = this.vel;
            vec3.copy(emitter.globalTranslation, this.pos);
        } else {
            emitter.directionalSpeed = 0.0;
            if (this.fadeTimer < 1)
                this.remove();
            else
                this.fadeTimer -= workData.deltaTime;
        }
    }

    public remove(): void {
        if (this.emitter === null)
            return;

        this.emitter.emitterCallBack = null;
        this.emitter.becomeInvalidEmitterImmediate();
        this.emitter = null;
        this.ddraw.destroy(this.globals.modelCache.device);
    }
}

export class dPa_trackEcallBack extends dPa_levelEcallBack {
    public emitter: JPABaseEmitter | null = null;

    public state = -1;
    private pos: ReadonlyVec3;
    private rot: ReadonlyVec3;
    private alpha: number = 1.0;

    private ddraw = new TDDraw();

    public vel: number = 0.0;
    public minVel: number = 3.0;
    public indScaleY: number = 1.0;
    public indTransY: number = 0.0;
    public baseY: number = 0.0;
    public minY: number = -Infinity;

    private trackPrevPos = nArray(3, () => vec3.create());

    constructor(protected override globals: dGlobals) {
        super(globals);

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
    }

    public override draw(emitter: JPABaseEmitter, device: GfxDevice, renderInstManager: GfxRenderInstManager): void {
        // There should always be a multiple of three particles, with how we emit them.
        const trackCount = (emitter.aliveParticlesBase.length / 3) | 0;
        if (trackCount < 2)
            return;

        const workData = emitter.emitterManager.workData;
        const ddraw = this.ddraw;
        ddraw.beginDraw(renderInstManager.gfxRenderCache);
        ddraw.allocPrimitives(GX.Command.DRAW_TRIANGLE_STRIP, 6 * (trackCount - 1));

        // Start from the back.
        const lastTrack = trackCount - 1;
        for (let j = 0; j < 3; j++) {
            const particle = emitter.aliveParticlesBase[lastTrack * 3 + j];
            vec3.copy(this.trackPrevPos[j], particle.position);
        }

        for (let i = lastTrack - 1; i >= 0; i--) {
            ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP, 6);
            const texTi = (lastTrack - i);
            const texT0 = (texTi - 0) / trackCount;
            const texT1 = (texTi - 1) / trackCount;

            for (let j = 0; j < 3; j++) {
                const particle = emitter.aliveParticlesBase[i * 3 + j];

                const texS = j * 0.5;
                vec3.copy(scratchVec3a, particle.position);
                this.getMaxWaterY(scratchVec3a);
                scratchVec3a[1] = emitter.aliveParticlesBase[0].position[1] + 5.0;
                ddraw.position3vec3(scratchVec3a);
                ddraw.texCoord2f32(GX.Attr.TEX0, texS, texT0);

                ddraw.position3vec3(this.trackPrevPos[j]);
                ddraw.texCoord2f32(GX.Attr.TEX0, texS, texT1);
                vec3.copy(this.trackPrevPos[j], scratchVec3a);
            }

            ddraw.end();
        }

        const indTexMtx = workData.materialParams.u_TexMtx[1];
        indTexMtx[5] = this.indScaleY;
        indTexMtx[13] = this.indTransY * emitter.age;

        const renderInst = ddraw.endDrawAndMakeRenderInst(renderInstManager);
        renderInst.sortKey = workData.particleSortKey;
        workData.fillParticleRenderInst(device, renderInstManager, renderInst);
        renderInstManager.submitRenderInst(renderInst);
    }

    public override setup(emitter: JPABaseEmitter, pos: ReadonlyVec3, rot: ReadonlyVec3): void {
        this.emitter = emitter;
        this.state = 0;
        this.pos = pos;
        this.rot = rot;
    }

    private getMaxWaterY(dst: vec3): void {
        const globals = this.globals, sea = globals.sea!;

        if (sea.ChkArea(globals, dst[0], dst[2])) {
            dst[1] = Math.max(sea.calcWave(globals, dst[0], dst[2]), this.minY);
        } else {
            if (Number.isFinite(this.minY))
                dst[1] = this.minY;
            else
                dst[1] = this.baseY;
        }

        dst[1] += 2.0;
    }

    public override execute(emitter: JPABaseEmitter): void {
        const workData = emitter.emitterManager.workData;

        dKy_get_seacolor(this.globals.g_env_light, emitter.globalColorPrm, null);
        emitter.globalColorPrm.a = this.alpha;

        if (this.state === 0) {
            vec3.copy(emitter.globalTranslation, this.pos);
            computeModelMatrixR(emitter.globalRotation, 0.0, cM_s2rad(this.rot[1]) * Math.sign(this.vel), 0.0);

            const fadingOut = Math.abs(this.vel) <= this.minVel;
            const incr = fadingOut ? -5 : 5;
            this.alpha = saturate(this.alpha + incr * workData.deltaTime);
        } else {
            this.alpha = Math.max(this.alpha - (10 / 0xFF) * workData.deltaTime, 0.0);
            if (this.alpha <= 0.0)
                this.remove();
        }

        for (let i = 0; i < emitter.aliveParticlesBase.length; i++) {
            const particle = emitter.aliveParticlesBase[i];
            this.getMaxWaterY(particle.offsetPosition);
        }
    }

    public remove(): void {
        if (this.emitter === null)
            return;

        this.emitter.emitterCallBack = null;
        this.emitter.becomeInvalidEmitterImmediate();
        this.emitter = null;
        this.ddraw.destroy(this.globals.modelCache.device);
    }
}
