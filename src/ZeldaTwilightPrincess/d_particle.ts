
// particle

import { ReadonlyMat4, ReadonlyVec3, vec2, vec3 } from "gl-matrix";
import { Color, colorCopy } from "../Color.js";
import { JPABaseEmitter, JPAC, JPACData, JPADrawInfo, JPAEmitterCallBack, JPAEmitterManager, JPAResourceData, JPAResourceRaw } from "../Common/JSYSTEM/JPA.js";
import { Frustum } from "../Geometry.js";
import { gfxDeviceNeedsFlipY } from "../gfx/helpers/GfxDeviceHelpers.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { EFB_HEIGHT, EFB_WIDTH } from "../gx/gx_material.js";
import { computeModelMatrixR, getMatrixTranslation } from "../MathHelpers.js";
import { TextureMapping } from "../TextureHolder.js";
import { ViewerRenderInput } from "../viewer.js";
import { cM_s2rad } from "../ZeldaWindWaker/SComponent.js";
import { dGlobals } from "./Main.js";

export abstract class dPa_levelEcallBack extends JPAEmitterCallBack {
    constructor(protected globals: dGlobals) {
        super();
    }

    public setup(emitter: JPABaseEmitter, pos: ReadonlyVec3 | null, rot: ReadonlyVec3 | null, setupInfo: number): void {
    }
}

const enum EffectDrawGroup {
    Main = 0,
    Indirect = 1,
}

function setTextureMappingIndirect(m: TextureMapping, flipY: boolean): void {
    m.width = EFB_WIDTH;
    m.height = EFB_HEIGHT;
    m.flipY = flipY;
    m.lateBinding = 'opaque-scene-texture';
}

export class dPa_control_c {
    private emitterManager: JPAEmitterManager;
    private drawInfo = new JPADrawInfo();
    private jpacData: JPACData[] = [];
    private resourceDatas = new Map<number, JPAResourceData>();

    constructor(cache: GfxRenderCache, private jpac: JPAC[]) {
        const device = cache.device;
        const flipY = gfxDeviceNeedsFlipY(device);
        this.emitterManager = new JPAEmitterManager(cache, 6000, 300);
        for (let i = 0; i < this.jpac.length; i++) {
            const jpacData = new JPACData(this.jpac[i]);

            const m = jpacData.getTextureMappingReference('AK_kagerouSwap00');
            if (m !== null)
                setTextureMappingIndirect(m, flipY);

            this.jpacData.push(jpacData);
        }
    }

    public setDrawInfo(posCamMtx: ReadonlyMat4, prjMtx: ReadonlyMat4, texPrjMtx: ReadonlyMat4 | null, frustum: Frustum): void {
        this.drawInfo.posCamMtx = posCamMtx;
        this.drawInfo.texPrjMtx = texPrjMtx;
        this.drawInfo.frustum = frustum;
    }

    public calc(viewerInput: ViewerRenderInput): void {
        const inc = viewerInput.deltaTime / 1000 * 30;

        // Some hacky distance culling for emitters.
        getMatrixTranslation(scratchVec3a, viewerInput.camera.worldMatrix);
        for (let i = 0; i < this.emitterManager.aliveEmitters.length; i++) {
            const emitter = this.emitterManager.aliveEmitters[i];
            if (vec3.distance(emitter.globalTranslation, scratchVec3a) > 5000) {
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

    public prepareToRender(device: GfxDevice): void {
        this.emitterManager.prepareToRender(device);
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
                const cache = globals.modelCache.renderCache;
                const resData = new JPAResourceData(cache, jpacData, jpaResRaw);
                this.resourceDatas.set(userIndex, resData);
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

        // HACK for now
        // This seems to mark it as an indirect particle (???) for simple particles.
        // ref. d_paControl_c::readCommon / readRoomScene
        if (!!(userID & 0x4000)) {
            baseEmitter.drawGroupId = EffectDrawGroup.Indirect;
        } else {
            baseEmitter.drawGroupId = EffectDrawGroup.Main;
        }

        if (pos !== null)
            vec3.copy(baseEmitter.globalTranslation, pos);
        if (rot !== null)
            computeModelMatrixR(baseEmitter.globalRotation, cM_s2rad(rot[0]), cM_s2rad(rot[1]), cM_s2rad(rot[2]));
        if (scale !== null)
            baseEmitter.setGlobalScale(scale);

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

    // TODO(jstpierre): Full simple particle system
/*
    public setSimple(globals: dGlobals, userID: number, pos: ReadonlyVec3, alpha: number = 1.0, colorPrm: Color | null = null, colorEnv: Color | null = null, affectedByWind: boolean = false): boolean {
        let groupID = EffectDrawGroup.Main;

        if (!!(userID & 0x4000))
            groupID = EffectDrawGroup.Indirect;

        this.set(globals, groupID, userID, pos, null, null, alpha, null, 0, colorPrm, colorEnv);
        return true;
    }
*/

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.jpacData.length; i++)
            this.jpacData[i].destroy(device);
        this.emitterManager.destroy(device);
    }
}

const scratchVec3a = vec3.create();
