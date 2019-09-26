
import * as RARC from '../../j3d/rarc';
import * as JPA from '../JPA';

import { createCsvParser, JMapInfoIter } from "./JMapInfo";
import { SceneObjHolder } from "./smg_scenes";
import { leftPad, assert, assertExists } from "../../util";
import { GfxDevice } from "../../gfx/platform/GfxPlatform";
import { GfxRenderInstManager } from "../../gfx/render/GfxRenderer";
import { vec3, mat4 } from "gl-matrix";
import { colorNewCopy, White, colorCopy, Color } from "../../Color";
import { computeModelMatrixR } from "../../MathHelpers";
import { DrawType } from "./NameObj";
import { LiveActor } from './LiveActor';
import { TextureMapping } from '../../TextureHolder';

export class ParticleResourceHolder {
    private effectNames: string[];
    private jpac: JPA.JPAC;
    private jpacData: JPA.JPACData;
    private resourceDatas = new Map<number, JPA.JPAResourceData>();
    public autoEffectList: JMapInfoIter;

    constructor(effectArc: RARC.RARC) {
        const effectNames = createCsvParser(effectArc.findFileData(`ParticleNames.bcsv`)!);
        this.effectNames = effectNames.mapRecords((iter) => {
            return assertExists(iter.getValueString('name'));
        });
        this.autoEffectList = createCsvParser(effectArc.findFileData(`AutoEffectList.bcsv`)!);

        const jpacData = effectArc.findFileData(`Particles.jpc`)!;
        this.jpac = JPA.parse(jpacData);
        this.jpacData = new JPA.JPACData(this.jpac);
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

        if (!this.resourceDatas.has(idx)) {
            const device = sceneObjHolder.modelCache.device;
            const cache = sceneObjHolder.modelCache.cache;
            const resData = new JPA.JPAResourceData(device, cache, this.jpacData, this.jpac.effects[idx]);
            resData.name = name;
            this.resourceDatas.set(idx, resData);
        }
        return this.resourceDatas.get(idx)!;
    }

    public getTextureMappingReference(name: string): TextureMapping | null {
        return this.jpacData.getTextureMappingReference(name);
    }

    public destroy(device: GfxDevice): void {
        this.jpacData.destroy(device);
    }
}

function parseColor(dst: Color, s: string): boolean {
    if (s === '')
        return false;

    assert(s.length === 7);
    dst.r = parseInt(s.slice(1, 3), 16) / 255;
    dst.g = parseInt(s.slice(3, 5), 16) / 255;
    dst.b = parseInt(s.slice(5, 7), 16) / 255;
    dst.a = 1.0;
    return true;
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
    public didInit = false;

    public init(baseEmitter: JPA.JPABaseEmitter): void {
        this.baseEmitter = baseEmitter;
        this.baseEmitter.flags |= JPA.BaseEmitterFlags.DO_NOT_TERMINATE;
        this.didInit = false;
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
    public visibleForce: boolean = true;

    public init(resource: JPA.JPAResourceData): void {
        this.resource = resource;

        // The original engine seems to unnecessarily create a ParticleEmitter
        // and then immediately destroy it to read this field (in scanParticleEmitter).
        // We just read the field directly lol.
        this.loopMode = resource.res.bem1.maxFrame === 0 ? EmitterLoopMode.FOREVER : EmitterLoopMode.ONE_TIME;
    }

    public deleteEmitter(): void {
        if (this.isValid())
            deleteParticleEmitter(this.particleEmitter!);
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
        this.particleEmitter.baseEmitter!.userData = this;
    }

    public unlink(): void {
        this.particleEmitter = null;
    }

    public isOneTime(): boolean {
        return this.loopMode === EmitterLoopMode.ONE_TIME;
    }

    public setDrawParticle(v: boolean) {
        if (this.isValid())
            this.particleEmitter!.baseEmitter!.setDrawParticle(v && this.visibleForce);
    }
}

const scratchColor = colorNewCopy(White);
export function setupMultiEmitter(m: MultiEmitter, autoEffectIter: JMapInfoIter): void {
    vec3.set(m.emitterCallBack.offset,
        autoEffectIter.getValueNumber('OffsetX', 0),
        autoEffectIter.getValueNumber('OffsetY', 0),
        autoEffectIter.getValueNumber('OffsetZ', 0),
    );
    const scaleValue = autoEffectIter.getValueNumber('ScaleValue', 1.0);
    if (scaleValue !== 1.0)
        m.emitterCallBack.setBaseScale(scaleValue);
    m.emitterCallBack.affectFlags = parseSRTFlags(assertExists(autoEffectIter.getValueString('Affect')));
    m.emitterCallBack.followFlags = parseSRTFlags(assertExists(autoEffectIter.getValueString('Follow')));

    if (parseColor(scratchColor, assertExists(autoEffectIter.getValueString('PrmColor'))))
        m.setGlobalPrmColor(scratchColor);
    if (parseColor(scratchColor, assertExists(autoEffectIter.getValueString('EnvColor'))))
        m.setGlobalEnvColor(scratchColor);

    const drawOrder = autoEffectIter.getValueString('DrawOrder');
    if (drawOrder === 'AFTER_INDIRECT')
        m.setDrawOrder(DrawType.EFFECT_DRAW_AFTER_INDIRECT);
    else if (drawOrder === 'INDIRECT')
        m.setDrawOrder(DrawType.EFFECT_DRAW_INDIRECT);
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

    const animName = assertExists(autoEffectIter.getValueString('AnimName'));
    if (animName !== '') {
        m.animNames = animName.toLowerCase().split(' ');
        m.startFrame = assertExists(autoEffectIter.getValueNumber('StartFrame'));
        m.endFrame = assertExists(autoEffectIter.getValueNumber('EndFrame'));
    } else {
        m.animNames = [];
        m.startFrame = 0;
        m.endFrame = -1;
    }

    m.continueAnimEnd = !!autoEffectIter.getValueNumber('ContinueAnimEnd', 0);
}

class MultiEmitterCallBack implements JPA.JPAEmitterCallBack {
    public globalColorPrm: Color = colorNewCopy(White);
    public globalColorEnv: Color = colorNewCopy(White);
    public offset = vec3.create();
    public baseScale: number | null = null;
    public affectFlags: SRTFlags = 0;
    public followFlags: SRTFlags = 0;

    public hostMtx: mat4 | null = null;
    public hostTranslation: vec3 | null = null;
    public hostRotation: vec3 | null = null;
    public hostScale: vec3 | null = null;

    private setEffectSRT(emitter: JPA.JPABaseEmitter, scale: vec3 | null, rot: mat4 | null, trans: vec3 | null, srtFlags: SRTFlags, isInit: boolean): void {
        if (!!(srtFlags & SRTFlags.T)) {
            if (!!(srtFlags & SRTFlags.R))
                vec3.transformMat4(scratchVec3c, this.offset, rot!);
            else
                vec3.copy(scratchVec3c, this.offset);

            if (!!(srtFlags & SRTFlags.S))
                vec3.mul(scratchVec3c, scratchVec3c, scale!);

            vec3.add(emitter.globalTranslation, trans!, scratchVec3c);
        }

        if (!!(srtFlags & SRTFlags.R)) {
            mat4.copy(emitter.globalRotation, rot!);
        }

        // setScaleFromHostScale
        if (!!(srtFlags & SRTFlags.S)) {
            if (this.hostScale !== null)
                vec3.copy(scratchVec3c, this.hostScale!);
            else
                vec3.copy(scratchVec3c, scale!);
            if (this.baseScale !== null)
                vec3.scale(scratchVec3c, scratchVec3c, this.baseScale);
            emitter.setGlobalScale(scratchVec3c);
        } else {
            if (isInit && this.baseScale !== null) {
                vec3.set(scratchVec3c, this.baseScale, this.baseScale, this.baseScale);
                emitter.setGlobalScale(scratchVec3c);
            }
        }
    }

    private setSRTFromHostMtx(emitter: JPA.JPABaseEmitter, mtx: mat4, srtFlags: SRTFlags, isInit: boolean): void {
        const scale = scratchVec3a;
        const rot = scratchMatrix;
        const trans = scratchVec3b;
        JPA.JPASetRMtxSTVecFromMtx(scale, rot, trans, mtx);
        this.setEffectSRT(emitter, scale, rot, trans, srtFlags, isInit);
    }

    private setSRTFromHostSRT(emitter: JPA.JPABaseEmitter, scale: vec3 | null, rot: vec3 | null, trans: vec3 | null, srtFlags: SRTFlags, isInit: boolean): void {
        if (!!(srtFlags & SRTFlags.R))
            computeModelMatrixR(scratchMatrix, rot![0], rot![1], rot![2]);
        this.setEffectSRT(emitter, scale, scratchMatrix, trans, srtFlags, isInit);
    }

    private isFollowSRT(isInit: boolean): SRTFlags {
        let srtFlags = isInit ? this.affectFlags : this.followFlags;

        // TODO(jstpierre): forceFollowOff

        if (this.hostMtx === null && this.hostTranslation === null) {
            srtFlags &= ~SRTFlags.T;
        } else {
            // TODO(jstpierre): forceFollowOn
        }

        if (this.hostMtx === null && this.hostRotation === null) {
            srtFlags &= ~SRTFlags.R;
        } else {
            // TODO(jstpierre): forceRotateOn??? (flag is never set anywhere)
        }

        if (this.hostMtx === null && this.hostScale === null) {
            srtFlags &= ~SRTFlags.S;
        } else {
            // TODO(jstpierre): forceScaleOn
        }

        return srtFlags;
    }

    private followSRT(emitter: JPA.JPABaseEmitter, isInit: boolean): void {
        const srtFlags = this.isFollowSRT(isInit);
        if (this.hostMtx !== null)
            this.setSRTFromHostMtx(emitter, this.hostMtx, srtFlags, isInit);
        else
            this.setSRTFromHostSRT(emitter, this.hostScale, this.hostRotation, this.hostTranslation, srtFlags, isInit);
    }

    private setColor(emitter: JPA.JPABaseEmitter): void {
        colorCopy(emitter.globalColorEnv, this.globalColorEnv);
        colorCopy(emitter.globalColorPrm, this.globalColorPrm);
    }

    public execute(emitter: JPA.JPABaseEmitter): void {
        this.followSRT(emitter, false);
        // this.effectLight(emitter);
        this.setColor(emitter);
    }

    public init(emitter: JPA.JPABaseEmitter): void {
        this.followSRT(emitter, true);
    }

    public setHostMtx(hostMtx: mat4, hostScale: vec3 | null = null): void {
        this.hostScale = hostScale;
        this.hostRotation = null;
        this.hostTranslation = null;
        this.hostMtx = hostMtx;
    }

    public setHostSRT(hostTranslation: vec3 | null, hostRotation: vec3 | null, hostScale: vec3 | null): void {
        this.hostTranslation = hostTranslation;
        this.hostRotation = hostRotation;
        this.hostScale = hostScale;
        this.hostMtx = null;
    }

    public setBaseScale(baseScale: number): void {
        this.baseScale = baseScale;
    }
}

const scratchMatrix = mat4.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
export class MultiEmitter {
    private singleEmitters: SingleEmitter[] = [];
    public childEmitters: MultiEmitter[] = [];
    public name: string;
    public drawType: DrawType;
    public animNames: string[];
    public startFrame: number;
    public endFrame: number;
    public continueAnimEnd: boolean;
    public bckName: string | null = null;
    public emitterCallBack = new MultiEmitterCallBack();

    constructor(sceneObjHolder: SceneObjHolder, effectName: string) {
        this.allocateEmitter(sceneObjHolder, effectName);
    }

    private allocateEmitter(sceneObjHolder: SceneObjHolder, effectName: string): void {
        const particleResourceHolder = sceneObjHolder.effectSystem!.particleResourceHolder;

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
            const resData = assertExists(particleResourceHolder.getResourceData(sceneObjHolder, qualifiedEffectNames[i]));
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
            effectSystem.createSingleEmitter(this.singleEmitters[i], this.emitterCallBack);
        for (let i = 0; i < this.childEmitters.length; i++)
            this.childEmitters[i].createEmitter(effectSystem);
    }

    public createOneTimeEmitter(effectSystem: EffectSystem): void {
        for (let i = 0; i < this.singleEmitters.length; i++)
            if (this.singleEmitters[i].isOneTime())
                effectSystem.createSingleEmitter(this.singleEmitters[i], this.emitterCallBack);
    }

    public createForeverEmitter(effectSystem: EffectSystem): void {
        for (let i = 0; i < this.singleEmitters.length; i++)
            if (!this.singleEmitters[i].isOneTime())
                effectSystem.createSingleEmitter(this.singleEmitters[i], this.emitterCallBack);
    }

    public deleteEmitter(): void {
        for (let i = 0; i < this.singleEmitters.length; i++)
            this.singleEmitters[i].deleteEmitter();
        for (let i = 0; i < this.childEmitters.length; i++)
            this.childEmitters[i].deleteEmitter();
    }

    public forceDeleteEmitter(effectSystem: EffectSystem): void {
        for (let i = 0; i < this.singleEmitters.length; i++)
            effectSystem.forceDeleteSingleEmitter(this.singleEmitters[i]);
        for (let i = 0; i < this.childEmitters.length; i++)
            this.childEmitters[i].forceDeleteEmitter(effectSystem);
    }

    public deleteForeverEmitter(): void {
        for (let i = 0; i < this.singleEmitters.length; i++)
            if (!this.singleEmitters[i].isOneTime())
                this.singleEmitters[i].deleteEmitter();
        for (let i = 0; i < this.childEmitters.length; i++)
            this.childEmitters[i].deleteForeverEmitter();
    }

    public setName(name: string): void {
        this.name = name;
    }

    public setDrawParticle(v: boolean): void {
        for (let i = 0; i < this.singleEmitters.length; i++) {
            const emitter = this.singleEmitters[i];
            if (!emitter.isValid())
                continue;
            emitter.setDrawParticle(v);
        }
    }

    public setGlobalPrmColor(color: Color, emitterIndex: number = -1): void {
        if (emitterIndex === -1) {
            colorCopy(this.emitterCallBack.globalColorPrm, color);
            for (let i = 0; i < this.singleEmitters.length; i++) {
                const emitter = this.singleEmitters[i];
                if (emitter.isValid())
                    emitter.particleEmitter!.setGlobalPrmColor(color);
            }
        } else {
            const emitter = this.singleEmitters[emitterIndex];
            if (emitter.isValid())
                emitter.particleEmitter!.setGlobalPrmColor(color);
        }
    }

    public setGlobalEnvColor(color: Color, emitterIndex: number = -1): void {
        if (emitterIndex === -1) {
            colorCopy(this.emitterCallBack.globalColorEnv, color);
            for (let i = 0; i < this.singleEmitters.length; i++) {
                const emitter = this.singleEmitters[i];
                if (emitter.isValid())
                    emitter.particleEmitter!.setGlobalEnvColor(color);
            }
        } else {
            const emitter = this.singleEmitters[emitterIndex];
            if (emitter.isValid())
                emitter.particleEmitter!.setGlobalEnvColor(color);
        }
    }

    public setHostSRT(translation: vec3 | null, rotation: vec3 | null, scale: vec3 | null): void {
        this.emitterCallBack.setHostSRT(translation, rotation, scale);
    }

    public setHostMtx(hostMtx: mat4): void {
        this.emitterCallBack.setHostMtx(hostMtx);
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
    private currentBckName: string | null = null;
    private visibleScenario: boolean = true;
    private visibleDrawParticle: boolean = true;

    constructor(sceneObjHolder: SceneObjHolder, public actor: LiveActor, public groupName: string) {
        registerAutoEffectInGroup(sceneObjHolder, this, this.actor, this.groupName);
    }

    public addAutoEffect(sceneObjHolder: SceneObjHolder, autoEffectInfo: JMapInfoIter): void {
        const m = new MultiEmitter(sceneObjHolder, assertExists(autoEffectInfo.getValueString('EffectName')));
        m.setName(assertExists(autoEffectInfo.getValueString('UniqueName')));

        let jointName = autoEffectInfo.getValueString('JointName');
        if (jointName === '')
            jointName = null;
    
        // registerEmitter
        if (jointName !== null) {
            const jointMtx = assertExists(this.actor.getJointMtx(jointName));
            m.emitterCallBack.setHostMtx(jointMtx);
        } else {
            const baseMtx = this.actor.getBaseMtx();
            if (baseMtx !== null) {
                m.emitterCallBack.setHostMtx(baseMtx, this.actor.scale);
            } else {
                m.emitterCallBack.setHostSRT(this.actor.translation, this.actor.rotation, this.actor.scale);
            }
        }

        setupMultiEmitter(m, autoEffectInfo);

        const parentName = autoEffectInfo.getValueString('ParentName', '');
        if (parentName !== '') {
            const parentEmitter = assertExists(this.getEmitter(parentName));
            parentEmitter.childEmitters.push(m);
        }

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
        if (multiEmitter !== null)
            multiEmitter.createEmitter(sceneObjHolder.effectSystem!);
        return multiEmitter;
    }

    public deleteEmitter(sceneObjHolder: SceneObjHolder, name: string): void {
        const multiEmitter = this.getEmitter(name);
        if (multiEmitter !== null)
            multiEmitter.deleteEmitter();
    }

    public forceDeleteEmitter(sceneObjHolder: SceneObjHolder, name: string): void {
        const multiEmitter = this.getEmitter(name);
        if (multiEmitter !== null)
            multiEmitter.forceDeleteEmitter(sceneObjHolder.effectSystem!);
    }

    public deleteEmitterAll(): void {
        for (let i = 0; i < this.multiEmitters.length; i++)
            this.multiEmitters[i].deleteEmitter();
    }

    public changeBck(bckName: string): void {
        this.currentBckName = bckName.toLowerCase();
    }

    public updateSyncBckEffect(effectSystem: EffectSystem): void {
        if (this.currentBckName === null)
            return;

        if (this.actor.modelInstance === null || this.actor.modelInstance.ank1Animator === null)
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
            if (created)
                multiEmitter.bckName = this.currentBckName;
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
                baseEmitter.aliveParticlesBase.length === 0 && baseEmitter.aliveParticlesChild.length === 0) {
                this.effectSystem.forceDeleteEmitter(emitter);
            } else {
                if (!emitter.didInit) {
                    if (baseEmitter.emitterCallBack !== null)
                        (baseEmitter.emitterCallBack as MultiEmitterCallBack).init(baseEmitter);
                    emitter.didInit = true;
                }
            }
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

    public makeMultiEmitterForUniqueName(sceneObjHolder: SceneObjHolder, uniqueName: string): MultiEmitter | null {
        const autoEffectInfo = this.particleResourceHolder.autoEffectList;

        if (!autoEffectInfo.findRecord((eff) => eff.getValueString('UniqueName') === uniqueName))
            return null;

        const m = new MultiEmitter(sceneObjHolder, assertExists(autoEffectInfo.getValueString('EffectName')));
        m.setName(assertExists(autoEffectInfo.getValueString('UniqueName')));
        setupMultiEmitter(m, autoEffectInfo);
        return m;
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

    public draw(device: GfxDevice, renderInstManager: GfxRenderInstManager, groupID: number): void {
        this.emitterManager.draw(device, renderInstManager, this.drawInfo, groupID);
    }

    private createEmitter(resData: JPA.JPAResourceData, groupID: number): ParticleEmitter | null {
        const particleEmitter = this.particleEmitterHolder.findAvailableParticleEmitter();
        if (particleEmitter === null)
            return null;
        const baseEmitter = assertExists(this.emitterManager.createEmitter(resData));
        baseEmitter.drawGroupId = groupID;
        particleEmitter.init(baseEmitter);
        return particleEmitter;
    }

    public createSingleEmitter(singleEmitter: SingleEmitter, emitterCallBack: JPA.JPAEmitterCallBack): void {
        if (singleEmitter.isValid()) {
            if (!singleEmitter.isOneTime())
                return;
            singleEmitter.unlink();
        }
    
        const emitter = this.createEmitter(singleEmitter.resource!, singleEmitter.groupID);

        if (emitter !== null) {
            singleEmitter.link(emitter);
            // Install MultiEmitterCallBack.
            const baseEmitter = emitter.baseEmitter!;

            if (emitterCallBack !== null)
                baseEmitter.emitterCallBack = emitterCallBack;
        }
    }

    public forceDeleteEmitter(emitter: ParticleEmitter): void {
        if (emitter.baseEmitter!.userData !== null) {
            const singleEmitter = emitter.baseEmitter!.userData as SingleEmitter;
            singleEmitter.particleEmitter = null;
        }

        this.emitterManager.forceDeleteEmitter(emitter.baseEmitter!);
        emitter.invalidate();
    }

    public forceDeleteSingleEmitter(singleEmitter: SingleEmitter): void {
        const emitter = singleEmitter.particleEmitter;
        if (emitter !== null) {
            singleEmitter.particleEmitter = null;
            this.emitterManager.forceDeleteEmitter(emitter.baseEmitter!);
            emitter.invalidate();
        }
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
