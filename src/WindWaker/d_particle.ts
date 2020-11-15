
// particle

import { mat4, ReadonlyVec3, vec2, vec3 } from "gl-matrix";
import { Color, colorCopy } from "../Color";
import { JPABaseEmitter, JPAEmitterManager, JPAResourceData, JPAEmitterCallBack, JPADrawInfo, JPACData, JPAC, JPAResourceRaw, BaseEmitterFlags, JPAEmitterWorkData } from "../Common/JSYSTEM/JPA";
import { Frustum } from "../Geometry";
import { GfxDevice, GfxTexture } from "../gfx/platform/GfxPlatform";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { EFB_HEIGHT, EFB_WIDTH } from "../gx/gx_material";
import { computeModelMatrixR, transformVec3Mat4w0 } from "../MathHelpers";
import { TDDraw } from "../SuperMarioGalaxy/DDraw";
import { TextureMapping } from "../TextureHolder";
import { nArray } from "../util";
import { ViewerRenderInput } from "../viewer";
import { dKy_get_seacolor } from "./d_kankyo";
import { cLib_addCalc2, cM__Short2Rad } from "./SComponent";
import { dGlobals } from "./zww_scenes";
import * as GX from '../gx/gx_enum';
import { ColorKind } from "../gx/gx_render";

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

function setTextureMappingIndirect(m: TextureMapping, sceneTexture: GfxTexture): void {
    m.gfxTexture = sceneTexture;
    m.width = EFB_WIDTH;
    m.height = EFB_HEIGHT;
    m.flipY = true;
}

export class dPa_control_c {
    private emitterManager: JPAEmitterManager;
    private drawInfo = new JPADrawInfo();
    private jpacData: JPACData[] = [];
    private resourceDatas = new Map<number, JPAResourceData>();

    constructor(device: GfxDevice, private jpac: JPAC[]) {
        this.emitterManager = new JPAEmitterManager(device, 6000, 300);
        for (let i = 0; i < this.jpac.length; i++)
            this.jpacData.push(new JPACData(this.jpac[i]));
    }

    public setOpaqueSceneTexture(opaqueSceneTexture: GfxTexture): void {
        for (let i = 0; i < this.jpacData.length; i++) {
            const m = this.jpacData[i].getTextureMappingReference('AK_kagerouSwap00');
            if (m !== null)
                setTextureMappingIndirect(m, opaqueSceneTexture);
        }
    }

    public setDrawInfo(posCamMtx: mat4, prjMtx: mat4, texPrjMtx: mat4 | null, frustum: Frustum): void {
        this.drawInfo.posCamMtx = posCamMtx;
        this.drawInfo.texPrjMtx = texPrjMtx;
        this.drawInfo.frustum = frustum;
    }

    public calc(viewerInput: ViewerRenderInput): void {
        const inc = viewerInput.deltaTime * 30/1000;
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
            computeModelMatrixR(baseEmitter.globalRotation, cM__Short2Rad(rot[0]), cM__Short2Rad(rot[1]), cM__Short2Rad(rot[2]));
        if (scale !== null) {
            vec3.copy(baseEmitter.globalScale, scale);
            vec2.set(baseEmitter.globalScale2D, scale[0], scale[1]);
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
            vec2.set(baseEmitter.globalScale2D, publicScale2D[0], publicScale2D[1]);

        return baseEmitter;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.jpacData.length; i++)
            this.jpacData[i].destroy(device);
        this.emitterManager.destroy(device);
    }
}

export class dPa_splashEcallBack extends dPa_levelEcallBack {
    public emitter: JPABaseEmitter | null = null;

    public scaleTimer = 0;
    public maxScaleTimer = 1;

    private state = -1;
    private pos: ReadonlyVec3;
    private rot: ReadonlyVec3;

    public setup(emitter: JPABaseEmitter, pos: ReadonlyVec3, rot: ReadonlyVec3): void {
        this.emitter = emitter;
        this.state = 0;
        this.pos = pos;
        this.rot = rot;
    }

    public execute(emitter: JPABaseEmitter): void {
        const deltaTimeFrames = emitter.emitterManager.workData.deltaTime;
        const globals = this.globals, envLight = globals.g_env_light;

        dKy_get_seacolor(envLight, emitter.globalColorPrm, null);
        if (this.state === 0) {
            vec3.copy(emitter.globalTranslation, this.pos);
            const scale = Math.min(this.scaleTimer / this.maxScaleTimer, 1.0);
            vec3.set(emitter.globalScale, scale, scale, scale);
            vec2.set(emitter.globalScale2D, scale, scale);
            emitter.initialVelDir = 15.0 * scale;
            computeModelMatrixR(emitter.globalRotation, 0.0, cM__Short2Rad(this.rot[1]), 0.0);
        } else {
            const scale = emitter.globalScale2D[0] - (0.2 * deltaTimeFrames);
            if (scale <= 0.0) {
                this.remove();
            } else {
                vec3.set(emitter.globalScale, scale, scale, scale);
                vec2.set(emitter.globalScale2D, scale, scale);
                emitter.initialVelDir = 15.0 * scale;
            }
        }
    }

    public remove(): void {
        if (this.emitter === null)
            return;

        this.emitter.emitterCallBack = null;
        this.emitter.maxFrame = -1;
        this.emitter.flags |= BaseEmitterFlags.STOP_EMIT_PARTICLES;
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
    public maxDistance = 10000.0;
    public collapsePos = nArray(2, () => vec3.create());

    private state = -1;
    private pos: ReadonlyVec3;
    private rot: ReadonlyVec3;
    private rotMtx = mat4.create();

    private ddraw = new TDDraw();

    constructor(protected globals: dGlobals) {
        super(globals);

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);
    }

    public setup(emitter: JPABaseEmitter, pos: ReadonlyVec3, rot: ReadonlyVec3): void {
        this.emitter = emitter;
        this.state = 0;
        this.pos = pos;
        this.rot = rot;
        this.vel = 0.0;
        this.velFade2 = 1.0;
        this.maxDistance = 10000.0;
    }

    public draw(emitter: JPABaseEmitter, device: GfxDevice, renderInstManager: GfxRenderInstManager, workData: JPAEmitterWorkData): void {
        const ddraw = this.ddraw;
        ddraw.beginDraw();

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

        const renderInst = ddraw.endDraw(device, renderInstManager);
        renderInst.sortKey = workData.particleSortKey;
        dKy_get_seacolor(this.globals.g_env_light, workData.materialParams.u_Color[ColorKind.C0], workData.materialParams.u_Color[ColorKind.C1]);
        workData.fillParticleRenderInst(device, renderInstManager, renderInst);
        renderInstManager.submitRenderInst(renderInst);
    }

    public executeAfter(emitter: JPABaseEmitter): void {
        const workData = emitter.emitterManager.workData;
        mat4.copy(this.rotMtx, workData.emitterGlobalRot);

        if (this.state === 0) {
            computeModelMatrixR(emitter.globalRotation, 0.0, cM__Short2Rad(this.rot[1]), 0.0);

            const distance = Math.min(vec3.distance(emitter.globalTranslation, this.pos), this.maxDistance);
            let velTarget = distance * this.velFade1 * this.velFade2;

            // TODO(jstpierre): Figure out why we need to fudge the velocity here...
            // it also doesn't look quite right -- should be a bit more rocky.
            velTarget *= 2.0;

            this.vel = cLib_addCalc2(this.vel, velTarget, 1.0, this.velSpeed);
            emitter.initialVelDir = this.vel;
            vec3.copy(emitter.globalTranslation, this.pos);
        } else {
            emitter.initialVelDir = 0.0;
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
        this.emitter.maxFrame = -1;
        this.emitter.flags |= BaseEmitterFlags.STOP_EMIT_PARTICLES;
        this.emitter = null;
        this.ddraw.destroy(this.globals.modelCache.device);
    }
}
