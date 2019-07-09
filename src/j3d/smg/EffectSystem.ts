
import { createCsvParser, JMapInfoIter } from "./JMapInfo";
import { SceneObjHolder, LiveActor } from "./smg_scenes";
import { leftPad, assert, assertExists } from "../../util";
import { GfxDevice } from "../../gfx/platform/GfxPlatform";

import * as RARC from '../../j3d/rarc';
import * as JPA from '../JPA';
import { Color } from "../../gx/gx_material";
import { vec3, mat4 } from "gl-matrix";
import { GXRenderHelperGfx } from "../../gx/gx_render_2";
import { colorNewCopy, White, colorCopy } from "../../Color";
import { computeModelMatrixR } from "../../MathHelpers";
import { DrawType } from "./NameObj";

export class ParticleResourceHolder {
    private effectNames: string[];
    private jpac: JPA.JPAC;
    private resourceDatas = new Map<number, JPA.JPAResourceData>();
    public autoEffectList: JMapInfoIter;

    constructor(effectArc: RARC.RARC) {
        const effectNames = createCsvParser(effectArc.findFileData(`ParticleNames.bcsv`));
        this.effectNames = effectNames.mapRecords((iter) => {
            return iter.getValueString('name');
        });
        this.autoEffectList = createCsvParser(effectArc.findFileData(`AutoEffectList.bcsv`));

        const jpacData = effectArc.findFileData(`Particles.jpc`);
        this.jpac = JPA.parse(jpacData);
    }

    public getUserIndex(name: string): number {
        return this.effectNames.findIndex((effectName) => effectName === name);
    }

    public getResourceRaw(name: string): JPA.JPAResourceRaw {
        return this.jpac.effects[this.getUserIndex(name)];
    }

    public getResourceData(sceneObjHolder: SceneObjHolder, name: string): JPA.JPAResourceData | null {
        const idx = this.getUserIndex(name);
        if (idx < 0)
            return null;

        const device = sceneObjHolder.modelCache.device;
        if (!this.resourceDatas.has(idx)) {
            const resData = new JPA.JPAResourceData(device, this.jpac, this.jpac.effects[idx]);
            resData.name = name;
            this.resourceDatas.set(idx, resData);
        }
        return this.resourceDatas.get(idx);
    }

    public destroy(device: GfxDevice): void {
        for (const [, resourceData] of this.resourceDatas.entries())
            resourceData.destroy(device);
    }
}

function parseColor(dst: Color, s: string): void {
    if (s === '')
        return;

    assert(s.length === 7);
    dst.r = parseInt(s.slice(1, 3), 16) / 255;
    dst.g = parseInt(s.slice(3, 5), 16) / 255;
    dst.b = parseInt(s.slice(5, 7), 16) / 255;
    dst.a = 1.0;
}

function isDigitStringTail(s: string): boolean {
    return !!s.match(/\d+$/);
}

const enum SRTFlags {
    S = 1, R = 2, T = 4,
}

function parseSRTFlags(value: string): SRTFlags {
    let flags: SRTFlags = 0;
    if (value.includes('S'))
        flags |= SRTFlags.S;
    if (value.includes('R'))
        flags |= SRTFlags.R;
    if (value.includes('T'))
        flags |= SRTFlags.T;
    return flags;
}

class ParticleEmitter {
    public baseEmitter: JPA.JPABaseEmitter | null = null;

    public init(baseEmitter: JPA.JPABaseEmitter): void {
        this.baseEmitter = baseEmitter;
        this.baseEmitter.flags |= JPA.BaseEmitterFlags.DO_NOT_TERMINATE;
    }

    public invalidate(): void {
        this.baseEmitter = null;
    }

    public setGlobalPrmColor(color: Color): void {
        if (this.baseEmitter !== null)
            colorCopy(this.baseEmitter.globalColorPrm, color);
    }

    public setGlobalEnvColor(color: Color): void {
        if (this.baseEmitter !== null)
            colorCopy(this.baseEmitter.globalColorEnv, color);
    }
}

const enum EmitterLoopMode {
    ONE_TIME, FOREVER,
}

class SingleEmitter {
    public particleEmitter: ParticleEmitter | null = null;
    public resource: JPA.JPAResourceData | null = null;
    public groupID: number = 0;
    public loopMode: EmitterLoopMode;

    public init(resource: JPA.JPAResourceData): void {
        this.resource = resource;

        // The original engine seems to unnecessarily create a ParticleEmitter
        // and then immediately destroy it to read this field (in scanParticleEmitter).
        // We just read the field directly lol.
        this.loopMode = resource.res.bem1.maxFrame === 0 ? EmitterLoopMode.FOREVER : EmitterLoopMode.ONE_TIME;
    }

    public deleteEmitter(): void {
        if (this.isValid())
            deleteParticleEmitter(this.particleEmitter);
    }

    public isValid(): boolean {
        if (this.particleEmitter === null)
            return false;

        return this.particleEmitter.baseEmitter !== null;
    }

    public setGroupID(groupID: number): void {
        this.groupID = groupID;
    }

    public link(particleEmitter: ParticleEmitter): void {
        this.particleEmitter = particleEmitter;
        this.particleEmitter.baseEmitter.userData = this;
    }

    public unlink(): void {
        this.particleEmitter = null;
    }

    public isOneTime(): boolean {
        return this.loopMode === EmitterLoopMode.ONE_TIME;
    }

    public setDrawParticle(v: boolean) {
        if (this.isValid())
            this.particleEmitter.baseEmitter.setDrawParticle(v);
    }
}

export function setupMultiEmitter(m: MultiEmitter, autoEffectIter: JMapInfoIter): void {
    vec3.set(m.offset,
        autoEffectIter.getValueNumber('OffsetX', 0),
        autoEffectIter.getValueNumber('OffsetY', 0),
        autoEffectIter.getValueNumber('OffsetZ', 0),
    );
    m.scaleValue = autoEffectIter.getValueNumber('ScaleValue', 1.0);
    m.jointName = autoEffectIter.getValueString('JointName');
    if (m.jointName === '')
        m.jointName = null;
    m.affectFlags = parseSRTFlags(autoEffectIter.getValueString('Affect'));
    m.followFlags = parseSRTFlags(autoEffectIter.getValueString('Follow'));

    parseColor(m.globalPrmColor, autoEffectIter.getValueString('PrmColor'));
    parseColor(m.globalEnvColor, autoEffectIter.getValueString('EnvColor'));

    const drawOrder = autoEffectIter.getValueString('DrawOrder');
    if (drawOrder === 'AFTER_INDIRECT')
        m.setDrawOrder(DrawType.EFFECT_DRAW_AFTER_INDIRECT);
    else if (drawOrder === '3D')
        m.setDrawOrder(DrawType.EFFECT_DRAW_3D);
    else if (drawOrder === 'BLOOM_EFFECT')
        m.setDrawOrder(DrawType.EFFECT_DRAW_FOR_BLOOM_EFFECT);
    else if (drawOrder === 'AFTER_IMAGE_EFFECT')
        m.setDrawOrder(DrawType.EFFECT_DRAW_AFTER_IMAGE_EFFECT);
    else {
        console.warn('unknown draw order', drawOrder);
        m.setDrawOrder(DrawType.EFFECT_DRAW_3D);
    }

    const animName = autoEffectIter.getValueString('AnimName');
    if (animName !== '') {
        m.animNames = animName.toLowerCase().split(' ');
        m.startFrame = autoEffectIter.getValueNumber('StartFrame');
        m.endFrame = autoEffectIter.getValueNumber('EndFrame');
    } else {
        m.animNames = [];
        m.startFrame = 0;
        m.endFrame = -1;
    }

    m.continueAnimEnd = !!autoEffectIter.getValueNumber('ContinueAnimEnd', 0);
}

const scratchMatrix = mat4.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
export class MultiEmitter {
    private singleEmitters: SingleEmitter[] = [];
    public name: string;
    public offset = vec3.create();
    public scaleValue: number = 0;
    public drawType: DrawType;
    public globalPrmColor = colorNewCopy(White);
    public globalEnvColor = colorNewCopy(White);
    public affectFlags: SRTFlags = 0;
    public followFlags: SRTFlags = 0;
    public jointName: string;
    public animNames: string[];
    public startFrame: number;
    public endFrame: number;
    public continueAnimEnd: boolean;
    public bckName: string | null = null;

    constructor(sceneObjHolder: SceneObjHolder, effectName: string) {
        this.allocateEmitter(sceneObjHolder, effectName);
    }

    private allocateEmitter(sceneObjHolder: SceneObjHolder, effectName: string): void {
        const particleResourceHolder = sceneObjHolder.effectSystem.particleResourceHolder;

        let qualifiedEffectNames: string[] = [];

        if (effectName.includes(' ')) {
            // If we have spaces, then we have multiple qualified emitter names separated by spaces.
            qualifiedEffectNames = effectName.split(' ');
        } else if (isDigitStringTail(effectName)) {
            qualifiedEffectNames.push(effectName);
        } else {
            let i = 0;
            while (true) {
                const qualEffectName = `${effectName}${leftPad('' + i, 2, '0')}`;
                const userIndex = particleResourceHolder.getUserIndex(qualEffectName);
                if (userIndex < 0)
                    break;
                qualifiedEffectNames.push(qualEffectName);
                i++;
            }
        }

        for (let i = 0; i < qualifiedEffectNames.length; i++) {
            const resData = particleResourceHolder.getResourceData(sceneObjHolder, qualifiedEffectNames[i]);
            const singleEmitter = new SingleEmitter();
            singleEmitter.init(resData);
            this.singleEmitters.push(singleEmitter);
        }
    }

    public setDrawOrder(drawOrder: DrawType): void {
        for (let i = 0; i < this.singleEmitters.length; i++)
            this.singleEmitters[i].setGroupID(drawOrder);
    }

    public createEmitter(effectSystem: EffectSystem): void {
        for (let i = 0; i < this.singleEmitters.length; i++)
            effectSystem.createSingleEmitter(this.singleEmitters[i]);
        this.setColors();
    }

    public createOneTimeEmitter(effectSystem: EffectSystem): void {
        for (let i = 0; i < this.singleEmitters.length; i++)
            if (this.singleEmitters[i].isOneTime())
                effectSystem.createSingleEmitter(this.singleEmitters[i]);
        this.setColors();
    }

    public createForeverEmitter(effectSystem: EffectSystem): void {
        for (let i = 0; i < this.singleEmitters.length; i++)
            if (!this.singleEmitters[i].isOneTime())
                effectSystem.createSingleEmitter(this.singleEmitters[i]);
        this.setColors();
    }

    public deleteEmitter(): void {
        for (let i = 0; i < this.singleEmitters.length; i++)
            this.singleEmitters[i].deleteEmitter();
    }

    public deleteForeverEmitter(): void {
        for (let i = 0; i < this.singleEmitters.length; i++)
            if (!this.singleEmitters[i].isOneTime())
                this.singleEmitters[i].deleteEmitter();
    }

    public setName(name: string): void {
        this.name = name;
    }

    public setDrawParticle(v: boolean): void {
        for (let i = 0; i < this.singleEmitters.length; i++) {
            const emitter = this.singleEmitters[i];
            if (!emitter.isValid())
                continue;
            emitter.particleEmitter.baseEmitter.setDrawParticle(v);
        }
    }

    private setSRT(scale: vec3 | null, rotation: mat4 | null, translation: vec3 | null): void {
        for (let i = 0; i < this.singleEmitters.length; i++) {
            const emitter = this.singleEmitters[i];
            if (!emitter.isValid())
                continue;
            const baseEmitter = emitter.particleEmitter.baseEmitter;

            if (scale !== null)
                baseEmitter.setGlobalScale(scale);
            if (translation !== null)
                vec3.copy(baseEmitter.globalTranslation, translation);
            if (rotation !== null)
                mat4.copy(baseEmitter.globalRotation, rotation);
        }
    }

    private followSRT(scale: vec3, rot: mat4, trans: vec3, isFollow: boolean): void {
        const srtFlags = isFollow ? this.followFlags : this.affectFlags;

        if (!!(srtFlags & SRTFlags.T)) {
            vec3.transformMat4(scratchVec3c, this.offset, rot);

            if (!!(srtFlags & SRTFlags.S))
                vec3.mul(scratchVec3c, scratchVec3c, scale);

            vec3.add(trans, trans, scratchVec3c);
        } else if (!isFollow) {
            vec3.copy(scale, this.offset);
        } else {
            trans = null;
        }

        if (!!(srtFlags & SRTFlags.R)) {
            // TODO(jstpierre): isEffect2D branch
        } else {
            rot = null;
        }

        if (!!(srtFlags & SRTFlags.S)) {
            vec3.scale(scale, scale, this.scaleValue);
        } else if (!isFollow) {
            vec3.set(scale, this.scaleValue, this.scaleValue, this.scaleValue);
        } else {
            scale = null;
        }

        this.setSRT(scale, rot, trans);
    }

    private setColors(): void {
        for (let i = 0; i < this.singleEmitters.length; i++) {
            const emitter = this.singleEmitters[i];
            if (!emitter.isValid())
                continue;
            emitter.particleEmitter.setGlobalPrmColor(this.globalPrmColor);
            emitter.particleEmitter.setGlobalEnvColor(this.globalEnvColor);
        }
    }

    public setSRTFromHostMtx(mtx: mat4, isFollow: boolean): void {
        const scale = scratchVec3a;
        const rot = scratchMatrix;
        const trans = scratchVec3b;
        JPA.JPASetRMtxSTVecFromMtx(scale, rot, trans, mtx);
        this.followSRT(scale, rot, trans, isFollow);
    }

    public setSRTFromHostSRT(scaleIn: vec3, rotIn: vec3, transIn: vec3, isFollow: boolean): void {
        const scale = scratchVec3a;
        const rot = scratchMatrix;
        const trans = scratchVec3b;
        vec3.copy(scale, scaleIn);
        computeModelMatrixR(rot, rotIn[0], rotIn[1], rotIn[2]);
        vec3.copy(trans, transIn);
        this.followSRT(scale, rot, trans, isFollow);
    }

    public setGlobalEnvColor(color: Color, emitterIndex: number = -1): void {
        for (let i = 0; i < this.singleEmitters.length; i++) {
            const emitter = this.singleEmitters[i];
            if (emitter.isValid() && emitterIndex < 0 || i === emitterIndex)
                emitter.particleEmitter.setGlobalEnvColor(color);
        }
    }
}

function registerAutoEffectInGroup(sceneObjHolder: SceneObjHolder, effectKeeper: EffectKeeper, actor: LiveActor, groupName: string): void {
    if (sceneObjHolder.effectSystem === null)
        return;

    const autoEffectList = sceneObjHolder.effectSystem.particleResourceHolder.autoEffectList;
    for (let i = 0; i < autoEffectList.getNumRecords(); i++) {
        autoEffectList.setRecord(i);
        if (autoEffectList.getValueString('GroupName') === groupName)
            effectKeeper.addAutoEffect(sceneObjHolder, autoEffectList);
    }
}

function isCreate(multiEmitter: MultiEmitter, currentBckName: string, frame: number, loopMode: EmitterLoopMode): boolean {
    if (multiEmitter.bckName !== currentBckName) {
        if (multiEmitter.animNames.includes(currentBckName)) {
            if (loopMode === EmitterLoopMode.FOREVER) {
                return true;
            } else {
                if (frame >= multiEmitter.startFrame)
                    return true;
            }
        }
    }
    return false;
}

function isDelete(multiEmitter: MultiEmitter, currentBckName: string, frame: number): boolean {
    if (multiEmitter.bckName === currentBckName) {
        if (multiEmitter.endFrame >= 0 && frame > multiEmitter.endFrame)
            return true;
    } else if (multiEmitter.bckName !== null) {
        if (!multiEmitter.continueAnimEnd)
            return true;
    }
    return false;
}

export class EffectKeeper {
    public multiEmitters: MultiEmitter[] = [];
    private autoFollow: boolean = true;
    private currentBckName: string | null = null;
    private visibleScenario: boolean = true;
    private visibleDrawParticle: boolean = true;

    constructor(sceneObjHolder: SceneObjHolder, public actor: LiveActor, public groupName: string) {
        registerAutoEffectInGroup(sceneObjHolder, this, this.actor, this.groupName);
    }

    public addAutoEffect(sceneObjHolder: SceneObjHolder, autoEffectInfo: JMapInfoIter): void {
        const m = new MultiEmitter(sceneObjHolder, autoEffectInfo.getValueString('EffectName'));
        m.setName(autoEffectInfo.getValueString('UniqueName'));

        setupMultiEmitter(m, autoEffectInfo);
        this.multiEmitters.push(m);
    }

    public getEmitter(name: string): MultiEmitter | null {
        for (let i = 0; i < this.multiEmitters.length; i++)
            if (this.multiEmitters[i].name === name)
                return this.multiEmitters[i];
        return null;
    }

    public isRegisteredEmitter(name: string): boolean {
        return this.getEmitter(name) !== null;
    }

    public createEmitter(sceneObjHolder: SceneObjHolder, name: string): MultiEmitter | null {
        const multiEmitter = this.getEmitter(name);
        if (multiEmitter !== null) {
            multiEmitter.createEmitter(sceneObjHolder.effectSystem);
            this.setHostSRT(multiEmitter, false);
        }
        return multiEmitter;
    }

    public deleteEmitter(name: string): void {
        const multiEmitter = this.getEmitter(name);
        if (multiEmitter !== null)
            multiEmitter.deleteEmitter();
    }

    public deleteEmitterAll(): void {
        for (let i = 0; i < this.multiEmitters.length; i++)
            this.multiEmitters[i].deleteEmitter();
    }

    private setHostSRT(multiEmitter: MultiEmitter, isFollow: boolean): void {
        if (multiEmitter.jointName !== null) {
            const jointMtx = this.actor.getJointMtx(multiEmitter.jointName);
            multiEmitter.setSRTFromHostMtx(jointMtx, isFollow);
        } else {
            const baseMtx = this.actor.getBaseMtx();
            if (baseMtx !== null) {
                multiEmitter.setSRTFromHostMtx(baseMtx, isFollow);
            } else {
                multiEmitter.setSRTFromHostSRT(this.actor.scale, this.actor.rotation, this.actor.translation, isFollow);
            }
        }
    }

    public setSRTFromHostMtx(mtx: mat4): void {
        this.autoFollow = false;

        for (let i = 0; i < this.multiEmitters.length; i++)
            this.multiEmitters[i].setSRTFromHostMtx(mtx, true);
    }

    public followSRT(): void {
        if (!this.autoFollow)
            return;

        for (let i = 0; i < this.multiEmitters.length; i++)
            this.setHostSRT(this.multiEmitters[i], true);
    }

    public changeBck(bckName: string): void {
        this.currentBckName = bckName.toLowerCase();
    }

    public updateSyncBckEffect(effectSystem: EffectSystem): void {
        if (this.currentBckName === null)
            return;

        if (this.actor.modelInstance.ank1Animator === null)
            return;

        const timeInFrames = this.actor.modelInstance.ank1Animator.animationController.getTimeInFrames();
        for (let i = 0; i < this.multiEmitters.length; i++) {
            const multiEmitter = this.multiEmitters[i];

            let created = false;
            if (isCreate(multiEmitter, this.currentBckName, timeInFrames, EmitterLoopMode.ONE_TIME)) {
                multiEmitter.createOneTimeEmitter(effectSystem);
                created = true;
            }
            if (isCreate(multiEmitter, this.currentBckName, timeInFrames, EmitterLoopMode.FOREVER)) {
                multiEmitter.createForeverEmitter(effectSystem);
                created = true;
            }
            if (created) {
                multiEmitter.bckName = this.currentBckName;
                this.setHostSRT(multiEmitter, false);
            }
            if (isDelete(multiEmitter, this.currentBckName, timeInFrames)) {
                multiEmitter.deleteEmitter();
                multiEmitter.bckName = null;
            }
        }
    }

    private syncVisibility(): void {
        for (let i = 0; i < this.multiEmitters.length; i++)
            this.multiEmitters[i].setDrawParticle(this.visibleScenario && this.visibleDrawParticle);
    }

    public setVisibleScenario(v: boolean): void {
        this.visibleScenario = v;
        this.syncVisibility();
    }

    public setDrawParticle(v: boolean): void {
        this.visibleDrawParticle = v;
        this.syncVisibility();
    }
}

export class ParticleEmitterHolder {
    private particleEmitters: ParticleEmitter[] = [];

    constructor(private effectSystem: EffectSystem, maxParticleCount: number) {
        for (let i = 0; i < maxParticleCount; i++)
            this.particleEmitters.push(new ParticleEmitter());
    }

    public findAvailableParticleEmitter(): ParticleEmitter | null {
        for (let i = 0; i < this.particleEmitters.length; i++)
            if (this.particleEmitters[i].baseEmitter === null)
                return this.particleEmitters[i];
        return null;
    }

    public update(): void {
        for (let i = 0; i < this.particleEmitters.length; i++) {
            const emitter = this.particleEmitters[i];
            const baseEmitter = emitter.baseEmitter;
            if (baseEmitter === null)
                continue;

            if (!!(baseEmitter.flags & JPA.BaseEmitterFlags.TERMINATED) &&
                baseEmitter.aliveParticlesBase.length === 0 &&
                baseEmitter.aliveParticlesChild.length === 0)
                this.effectSystem.forceDeleteEmitter(emitter);
        }
    }
}

export class EffectSystem {
    public particleResourceHolder: ParticleResourceHolder;
    public particleEmitterHolder: ParticleEmitterHolder;
    public emitterManager: JPA.JPAEmitterManager;
    public drawInfo = new JPA.JPADrawInfo();

    constructor(device: GfxDevice, effectArc: RARC.RARC) {
        this.particleResourceHolder = new ParticleResourceHolder(effectArc);

        // These numbers are from GameScene::initEffect.
        const maxParticleCount = 0x1800;
        const maxEmitterCount = 0x200;
        this.emitterManager = new JPA.JPAEmitterManager(device, maxParticleCount, maxEmitterCount);

        this.particleEmitterHolder = new ParticleEmitterHolder(this, maxParticleCount);
    }

    public calc(deltaTime: number): void {
        this.particleEmitterHolder.update();
        this.emitterManager.calc(deltaTime);
    }

    public setDrawInfo(posCamMtx: mat4, prjMtx: mat4, texPrjMtx: mat4 | null): void {
        this.drawInfo.posCamMtx = posCamMtx;
        this.drawInfo.prjMtx = prjMtx;
        this.drawInfo.texPrjMtx = texPrjMtx;
    }

    public draw(device: GfxDevice, renderHelper: GXRenderHelperGfx, groupID: number): void {
        this.emitterManager.draw(device, renderHelper, this.drawInfo, groupID);
    }

    private createEmitter(resData: JPA.JPAResourceData, groupID: number): ParticleEmitter | null {
        const particleEmitter = this.particleEmitterHolder.findAvailableParticleEmitter();
        if (particleEmitter === null)
            return null;
        const baseEmitter = this.emitterManager.createEmitter(resData);
        baseEmitter.drawGroupId = groupID;
        particleEmitter.init(baseEmitter);
        return particleEmitter;
    }

    public createSingleEmitter(singleEmitter: SingleEmitter): void {
        if (singleEmitter.isValid()) {
            // if (!singleEmitter.isOneTime())
            //     return;
            singleEmitter.unlink();
        }
    
        const emitter = this.createEmitter(singleEmitter.resource, singleEmitter.groupID);

        if (emitter !== null) {
            singleEmitter.link(emitter);
            // Install MultiEmitterCallBack.
        }
    }

    public forceDeleteEmitter(emitter: ParticleEmitter): void {
        if (emitter.baseEmitter.userData !== null) {
            const singleEmitter = emitter.baseEmitter.userData as SingleEmitter;
            singleEmitter.particleEmitter = null;
        }

        this.emitterManager.forceDeleteEmitter(emitter.baseEmitter);
        emitter.invalidate();
    }

    public destroy(device: GfxDevice): void {
        this.particleResourceHolder.destroy(device);
        this.emitterManager.destroy(device);
    }
}

export function deleteParticleEmitter(emitter: ParticleEmitter): void {
    const baseEmitter = assertExists(emitter.baseEmitter);
    baseEmitter.flags |= JPA.BaseEmitterFlags.STOP_EMIT_PARTICLES;
    baseEmitter.maxFrame = 1;
}
