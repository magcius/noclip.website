
import { createCsvParser, JMapInfoIter } from "./JMapInfo";
import { SceneObjHolder, LiveActor } from "./smg_scenes";
import { leftPad, assert } from "../../util";
import { GfxDevice } from "../../gfx/platform/GfxPlatform";

import * as RARC from '../../j3d/rarc';
import * as JPA from '../JPA';
import { Color } from "../../gx/gx_material";
import { vec3, mat4 } from "gl-matrix";
import { GXRenderHelperGfx } from "../../gx/gx_render_2";
import { colorNew, colorNewCopy, White, colorCopy } from "../../Color";

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
        if (!this.resourceDatas.has(idx))
            this.resourceDatas.set(idx, new JPA.JPAResourceData(device, this.jpac, this.jpac.effects[idx]));
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

export const enum DrawOrder {
    DRW_3D,
    DRW_AFTER_INDIRECT,
}

export function setupMultiEmitter(m: MultiEmitter, autoEffectIter: JMapInfoIter): void {
    vec3.set(m.offset,
        autoEffectIter.getValueNumber('OffsetX', 0),
        autoEffectIter.getValueNumber('OffsetY', 0),
        autoEffectIter.getValueNumber('OffsetZ', 0),
    );

    parseColor(m.globalPrmColor, autoEffectIter.getValueString('PrmColor'));
    parseColor(m.globalEnvColor, autoEffectIter.getValueString('EnvColor'));

    const scaleValue = autoEffectIter.getValueNumber('ScaleValue', 1.0);
    vec3.set(m.scaleValue, scaleValue, scaleValue, scaleValue);

    const drawOrder = autoEffectIter.getValueString('DrawOrder');
    if (drawOrder === 'AFTER_INDIRECT')
        m.drawOrder = DrawOrder.DRW_AFTER_INDIRECT;
    else
        m.drawOrder = DrawOrder.DRW_3D;
}

export class MultiEmitter {
    private baseEmitters: JPA.JPABaseEmitter[] = [];
    private resources: JPA.JPAResourceData[] = [];
    public name: string;
    public offset = vec3.create();
    public translation = vec3.create();
    public scaleValue = vec3.create();
    public drawOrder: DrawOrder;
    public globalPrmColor = colorNewCopy(White);
    public globalEnvColor = colorNewCopy(White);

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
            this.resources.push(resData);
        }
    }

    public createEmitter(effectSystem: EffectSystem): void {
        for (let i = 0; i < this.resources.length; i++) {
            const baseEmitter = effectSystem.createSingleEmitter(this.resources[i]);
            // The real system uses callbacks. Here, we shove the values we want.
            baseEmitter.setGlobalScale(this.scaleValue);
            vec3.copy(baseEmitter.globalTranslation, this.offset);
            colorCopy(baseEmitter.globalColorPrm, this.globalPrmColor);
            colorCopy(baseEmitter.globalColorEnv, this.globalEnvColor);
            baseEmitter.drawGroupId = this.drawOrder;
            this.baseEmitters.push(baseEmitter);
        }
    }

    public setName(name: string): void {
        this.name = name;
    }

    public setDrawParticle(v: boolean): void {
        for (let i = 0; i < this.baseEmitters.length; i++)
            this.baseEmitters[i].setVisible(v);
    }

    public setGlobalTranslation(v: vec3): void {
        for (let i = 0; i < this.baseEmitters.length; i++)
            vec3.add(this.baseEmitters[i].globalTranslation, v, this.offset);
    }

    public getGlobalTranslation(): vec3 {
        return this.baseEmitters[0].globalTranslation;
    }

    public setHostSRT(scale: vec3, rotation: vec3, translation: vec3): void {
        this.setGlobalTranslation(translation);
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

export class EffectKeeper {
    public multiEmitters: MultiEmitter[] = [];

    constructor(sceneObjHolder: SceneObjHolder, public actor: LiveActor, public groupName: string) {
        registerAutoEffectInGroup(sceneObjHolder, this, this.actor, this.groupName);
    }

    public addAutoEffect(sceneObjHolder: SceneObjHolder, autoEffectInfo: JMapInfoIter): void {
        const m = new MultiEmitter(sceneObjHolder, autoEffectInfo.getValueString('EffectName'));
        m.setName(autoEffectInfo.getValueString('UniqueName'));

        // TODO(jstpierre): jointName and other fun facts.
        // const jointName = autoEffectInfo.getValueString('JointName');
        // if (jointName !== null) {
        // }
        m.translation = this.actor.translation;

        setupMultiEmitter(m, autoEffectInfo);
        this.multiEmitters.push(m);
    }

    public getEmitter(name: string): MultiEmitter | null {
        const emitter = this.multiEmitters.find((m) => m.name == name);
        if (emitter === undefined)
            return null;
        return emitter;
    }

    public createEmitter(sceneObjHolder: SceneObjHolder, name: string): MultiEmitter | null {
        const multiEmitter = this.getEmitter(name);
        if (multiEmitter !== null)
            multiEmitter.createEmitter(sceneObjHolder.effectSystem);
        return multiEmitter;
    }

    public setHostSRT(): void {
        for (let i = 0; i < this.multiEmitters.length; i++)
            this.multiEmitters[i].setHostSRT(this.actor.scale, this.actor.rotation, this.actor.translation);
    }
}

export class EffectSystem {
    public particleResourceHolder: ParticleResourceHolder;
    public emitterManager: JPA.JPAEmitterManager;
    public drawInfo = new JPA.JPADrawInfo();

    constructor(device: GfxDevice, effectArc: RARC.RARC) {
        this.particleResourceHolder = new ParticleResourceHolder(effectArc);

        // These numbers are from GameScene::initEffect.
        const maxParticleCount = 0x1800;
        const maxEmitterCount = 0x200;
        this.emitterManager = new JPA.JPAEmitterManager(device, maxParticleCount, maxEmitterCount);
    }

    public calc(deltaTime: number): void {
        this.emitterManager.calc(deltaTime);
    }

    public setDrawInfo(posCamMtx: mat4, prjMtx: mat4): void {
        this.drawInfo.posCamMtx = posCamMtx;
        this.drawInfo.prjMtx = prjMtx;
    }

    public draw(device: GfxDevice, renderHelper: GXRenderHelperGfx, groupId: number): void {
        this.emitterManager.draw(device, renderHelper, this.drawInfo, groupId);
    }

    public createSingleEmitter(resData: JPA.JPAResourceData): JPA.JPABaseEmitter | null {
        return this.emitterManager.createEmitter(resData);
    }

    public destroy(device: GfxDevice): void {
        this.particleResourceHolder.destroy(device);
        this.emitterManager.destroy(device);
    }
}
