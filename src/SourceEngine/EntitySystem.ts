
import { mat4, ReadonlyMat4, ReadonlyVec3, vec3 } from 'gl-matrix';
import { IS_DEVELOPMENT } from '../BuildVersion.js';
import { computeViewSpaceDepthFromWorldSpacePoint } from '../Camera.js';
import { Color, colorCopy, colorLerp, colorNewCopy, Cyan, Green, Magenta, Red, White } from '../Color.js';
import { drawWorldSpaceAABB, drawWorldSpaceLine, drawWorldSpaceLocator, drawWorldSpacePoint, drawWorldSpaceText, getDebugOverlayCanvas2D } from '../DebugJunk.js';
import { AABB } from '../Geometry.js';
import { projectionMatrixConvertClipSpaceNearZ } from '../gfx/helpers/ProjectionHelpers.js';
import { projectionMatrixReverseDepth } from '../gfx/helpers/ReversedDepthHelpers.js';
import { GfxClipSpaceNearZ, GfxDevice, GfxFormat } from '../gfx/platform/GfxPlatform.js';
import { GfxrGraphBuilder, GfxrRenderTargetDescription } from '../gfx/render/GfxRenderGraph.js';
import { GfxRenderInstManager, setSortKeyDepth } from '../gfx/render/GfxRenderInstManager.js';
import { clamp, computeModelMatrixR, computeModelMatrixSRT, getMatrixAxis, getMatrixAxisX, getMatrixAxisY, getMatrixAxisZ, getMatrixTranslation, invlerp, lerp, MathConstants, projectionMatrixForFrustum, randomRange, saturate, scaleMatrix, setMatrixTranslation, transformVec3Mat4w1, Vec3UnitX, Vec3UnitY, Vec3UnitZ, Vec3Zero } from '../MathHelpers.js';
import { getRandomInt, getRandomVector } from '../SuperMarioGalaxy/ActorUtil.js';
import { arrayRemove, assert, assertExists, fallbackUndefined, leftPad, nArray, nullify } from '../util.js';
import { BSPEntity } from './BSPFile.js';
import { BSPModelRenderer, BSPRenderer, BSPSurfaceRenderer, ProjectedLightRenderer, RenderObjectKind, SourceEngineView, SourceEngineViewType, SourceRenderContext, SourceRenderer, SourceWorldViewRenderer } from './Main.js';
import { ParticleControlPoint, ParticleSystemInstance } from './ParticleSystem.js';
import { SpriteInstance } from './Sprite.js';
import { computeMatrixForForwardDir } from './StaticDetailObject.js';
import { computeModelMatrixPosQAngle, computePosQAngleModelMatrix, StudioModelInstance } from "./Studio.js";
import { vmtParseColor, vmtParseNumber, vmtParseVector } from './VMT.js';
import { EntityMaterialParameters, FogParams, BaseMaterial } from './Materials/MaterialBase.js';
import { ParameterReference, paramSetNum } from './Materials/MaterialParameters.js';
import { LightCache, worldLightingCalcColorForPoint } from './Materials/WorldLight.js';

type EntityMessageValue = string;

function strColor(c: Color): string {
    return `${c.r} ${c.g} ${c.a}`;
}

interface EntityOutputAction {
    targetName: string;
    inputName: string;
    parameterOverride: string;
    delay: number;
    timesToFire: number;
}

function parseEntityOutputAction(S: string): EntityOutputAction {
    let parts: string[];
    if (S.includes('\x1b'))
        parts = S.split('\x1b');
    else
        parts = S.split(',');
    assert(parts.length === 5);
    const [targetNameStr, inputNameStr, parameterOverride, delayStr, timesToFireStr] = parts;
    const targetName = targetNameStr.toLowerCase();
    const inputName = inputNameStr.toLowerCase();
    const delay = Number(delayStr);
    const timesToFire = Number(timesToFireStr);
    return { targetName, inputName, parameterOverride, delay, timesToFire };
}

export class EntityOutput {
    public actions: EntityOutputAction[] = [];

    public parse(S: string | string[] | undefined): void {
        if (Array.isArray(S))
            S.forEach((s) => this.parse(s));
        else if (S !== undefined)
            this.actions.push(parseEntityOutputAction(S));
    }

    public getNumActions(): number {
        return this.actions.length;
    }

    public hasAnyActions(): boolean {
        return this.actions.length > 0;
    }

    public fire(entitySystem: EntitySystem, sender: BaseEntity, activator: BaseEntity, value: EntityMessageValue = ''): void {
        for (let i = 0; i < this.actions.length; i++)
            entitySystem.queueOutputEvent(this.actions[i], sender, activator, value);
    }
}

type EntityInputFunc = (entitySystem: EntitySystem, activator: BaseEntity, value: EntityMessageValue) => void;

const scratchMat4a = mat4.create();
const scratchMat4b = mat4.create();

const enum SpawnState {
    FetchingResources,
    ReadyForSpawn,
    Spawned,
}

function shouldHideEntityFallback(classname: string): boolean {
    if (classname === 'func_clip_vphysics')
        return true;
    if (classname === 'func_smokevolume')
        return true;
    if (classname.startsWith('func_nav_'))
        return true;
    return false;
}

// Some part of this is definitely BaseAnimating, maybe split at some point?
export class BaseEntity {
    public modelBSP: BSPModelRenderer | null = null;
    public modelStudio: StudioModelInstance | null = null;
    public modelSprite: SpriteInstance | null = null;

    public localOrigin = vec3.create();
    public localAngles = vec3.create();
    public rendercolor = colorNewCopy(White);
    public renderamt: number = 1.0;
    public rendermode: number = 0;
    public visible = true;
    public materialParams: EntityMaterialParameters | null = null;
    public skin: number = 0;
    public lightingOrigin = vec3.create();

    public targetName: string | null = null;
    public childEntity: BaseEntity[] = [];
    public parentEntity: BaseEntity | null = null;
    public parentAttachment: number | null = null;
    public modelMatrix = mat4.create();
    public alive = true;
    public enabled = true;
    public spawnState = SpawnState.ReadyForSpawn;

    public inputs = new Map<string, EntityInputFunc>();

    private output_onuser1 = new EntityOutput();
    private output_onuser2 = new EntityOutput();
    private output_onuser3 = new EntityOutput();
    private output_onuser4 = new EntityOutput();

    // Animation Playback (should probably be split out to a different class)
    private seqdefaultindex = -1;
    private seqindex = 0;
    private seqtime = 0;
    private seqplay: boolean = false;
    private seqrate = 1;
    private holdAnimation: boolean = false;

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, private bspRenderer: BSPRenderer, protected entity: BSPEntity) {
        if (entity.model)
            this.setModelName(renderContext, entity.model);

        if (entity.origin) {
            const origin = vmtParseVector(entity.origin);
            vec3.set(this.localOrigin, origin[0], origin[1], origin[2]);
        }

        if (entity.angles) {
            const angles = vmtParseVector(entity.angles);
            vec3.set(this.localAngles, angles[0], angles[1], angles[2]);
        }

        if (entity.rendercolor !== undefined)
            vmtParseColor(this.rendercolor, entity.rendercolor);
        this.renderamt = vmtParseNumber(entity.renderamt, 255.0) / 255.0;
        this.rendermode = vmtParseNumber(entity.rendermode, 0);

        if (entity.targetname)
            this.targetName = ('' + entity.targetname).toLowerCase();

        this.skin = vmtParseNumber(entity.skin, 0);

        if (entity.startdisabled)
            this.enabled = !Number(entity.startdisabled);
        else if (entity.start_disabled)
            this.enabled = !Number(entity.start_disabled);

        this.holdAnimation = !!Number(fallbackUndefined(this.entity.holdanimation, '0'));

        this.registerInput('enable', this.input_enable.bind(this));
        this.registerInput('disable', this.input_disable.bind(this));
        this.registerInput('enabledraw', this.input_enabledraw.bind(this));
        this.registerInput('disabledraw', this.input_disabledraw.bind(this));
        this.registerInput('kill', this.input_kill.bind(this));
        this.registerInput('killhierarchy', this.input_killhierarchy.bind(this))
        this.registerInput('skin', this.input_skin.bind(this));
        this.registerInput('use', this.input_use.bind(this));

        this.output_onuser1.parse(this.entity.onuser1);
        this.output_onuser2.parse(this.entity.onuser1);
        this.output_onuser3.parse(this.entity.onuser1);
        this.output_onuser4.parse(this.entity.onuser1);
        this.registerInput('fireuser1', this.input_fireuser1.bind(this));
        this.registerInput('fireuser2', this.input_fireuser2.bind(this));
        this.registerInput('fireuser3', this.input_fireuser3.bind(this));
        this.registerInput('fireuser4', this.input_fireuser4.bind(this));

        this.registerInput('setparent', this.input_setparent.bind(this));
        this.registerInput('clearparent', this.input_clearparent.bind(this));
        this.registerInput('setparentattachment', this.input_setparentattachment.bind(this));
        this.registerInput('setparentattachmentmaintainoffset', this.input_setparentattachmentmaintainoffset.bind(this));

        // TODO(jstpierre): This should be on baseanimation / prop_dynamic
        this.registerInput('setanimation', this.input_setanimation.bind(this));
        this.registerInput('setdefaultanimation', this.input_setdefaultanimation.bind(this));
        this.registerInput('setplaybackrate', this.input_setplaybackrate.bind(this));

        if (shouldHideEntityFallback(this.entity.classname))
            this.visible = false;
    }

    public shouldDraw(): boolean {
        if (!this.visible || !this.enabled || !this.alive || this.spawnState !== SpawnState.Spawned)
            return false;

        if (this.modelStudio !== null)
            return this.modelStudio.visible;
        else if (this.modelBSP !== null)
            return this.modelBSP.visible;

        return true;
    }

    public getLocalRenderBounds(): AABB | null {
        if (this.modelStudio !== null)
            return this.modelStudio.modelData.viewBB;
        else if (this.modelBSP !== null)
            return this.modelBSP.model.bbox;
        return null;
    }

    public getRenderBounds(dst: AABB): boolean {
        const bounds = this.getLocalRenderBounds();
        if (bounds === null)
            return false;
        dst.transform(bounds, this.modelMatrix);
        return true;
    }

    protected checkFrustum(renderContext: SourceRenderContext): boolean {
        this.getRenderBounds(scratchAABB);
        return renderContext.currentView.frustum.contains(scratchAABB);
    }

    public checkVisible(renderContext: SourceRenderContext): boolean {
        if (!this.shouldDraw() || !this.checkFrustum(renderContext))
            return false;

        if (this.getRenderBounds(scratchAABB)) {
            const bsp = this.bspRenderer.bsp, pvs = renderContext.currentView.pvs;
            let visible = false;
            bsp.queryAABB(scratchAABB, (leaf) => {
                if (pvs.getBit(leaf.cluster)) {
                    visible = true;
                    return false; // can stop here
                }

                return true; // keep going
            });
            return visible;
        } else {
            // Entity doesn't have render bounds, e.g. particle effects and such.
            return true;
        }
    }

    private findSequenceLabel(label: string): number {
        label = label.toLowerCase();
        return this.modelStudio!.modelData.seq.findIndex((seq) => seq.label === label);
    }

    // TODO(jstpierre): Move all this to a baseanimation type class?
    private playSequenceIndex(index: number): void {
        if (index < 0) {
            index = 0;
        }

        this.seqindex = index;
        this.seqplay = true;
        this.seqtime = 0;
    }

    public resetSequence(label: string): void {
        this.playSequenceIndex(this.findSequenceLabel(label));
    }

    public spawn(entitySystem: EntitySystem): void {
        if (this.entity.parentname)
            this.setParentEntity(entitySystem.findEntityByTargetName(this.entity.parentname));

        if (this.entity.defaultanim) {
            this.seqdefaultindex = this.findSequenceLabel(this.entity.defaultanim);
            this.playSequenceIndex(this.seqdefaultindex);
        }

        this.spawnState = SpawnState.Spawned;
    }

    protected ensureMaterialParams(): EntityMaterialParameters {
        if (this.materialParams === null)
            this.materialParams = new EntityMaterialParameters();

        return this.materialParams;
    }

    public setModelName(renderContext: SourceRenderContext, modelName: string): void {
        this.ensureMaterialParams();

        if (modelName.startsWith('*')) {
            const index = parseInt(modelName.slice(1), 10);
            this.modelBSP = this.bspRenderer.models[index];
            this.modelBSP.modelMatrix = this.modelMatrix;
            this.modelBSP.setEntity(this);
        } else if (modelName.endsWith('.mdl')) {
            this.fetchStudioModel(renderContext, modelName);
        } else if (modelName.endsWith('.vmt') || modelName.endsWith('.spr')) {
            this.fetchSpriteModel(renderContext, modelName);
        }
    }

    public remove(): void {
        this.alive = false;
    }

    protected removeWithChildren(): void {
        this.remove();
        for (let i = 0; i < this.childEntity.length; i++)
            this.childEntity[i].removeWithChildren();
    }

    protected registerInput(inputName: string, func: EntityInputFunc): void {
        assert(!this.inputs.has(inputName));
        this.inputs.set(inputName, func);
    }

    public fireInput(entitySystem: EntitySystem, inputName: string, activator: BaseEntity, value: EntityMessageValue): void {
        if (!this.alive)
            return;

        const func = this.inputs.get(inputName);
        if (!func) {
            console.warn(`Unknown input: ${this.targetName} (${this.entity.classname}) ${inputName} ${value}`);
            return;
        }

        func(entitySystem, activator, value);
    }

    private updateLightingData(): void {
        const materialParams = this.materialParams!;

        const modelMatrix = this.updateModelMatrix();
        getMatrixTranslation(materialParams.position, modelMatrix);

        if (this.modelStudio !== null) {
            transformVec3Mat4w1(this.lightingOrigin, modelMatrix, this.modelStudio.modelData.illumPosition);
        } else {
            vec3.copy(this.lightingOrigin, materialParams.position);
        }

        materialParams.lightCache = new LightCache(this.bspRenderer, this.lightingOrigin);
    }

    private async fetchStudioModel(renderContext: SourceRenderContext, modelName: string) {
        assert(this.spawnState === SpawnState.ReadyForSpawn);
        this.spawnState = SpawnState.FetchingResources;
        try {
            const modelData = await renderContext.studioModelCache.fetchStudioModelData(modelName!);
            // The Stanley Parable appears to ship models/apartment/picture_frame.mdl without a corresponding VVD/VTX file.
            if (modelData.bodyPartData.length !== 0) {
                this.modelStudio = new StudioModelInstance(renderContext, modelData, this.materialParams!);
                this.modelStudio.setSkin(renderContext, this.skin);
                this.updateLightingData();
            }
        } finally {
            this.spawnState = SpawnState.ReadyForSpawn;
        }
    }

    private async fetchSpriteModel(renderContext: SourceRenderContext, modelName: string) {
        assert(this.spawnState === SpawnState.ReadyForSpawn);
        this.spawnState = SpawnState.FetchingResources;
        const materialName = modelName.replace('.spr', '.vmt');
        const materialCache = renderContext.materialCache;
        const materialInstance = await materialCache.createMaterialInstance(materialName);
        materialInstance.paramSetNumber('$rendermode', this.rendermode);
        materialInstance.entityParams = this.ensureMaterialParams();
        await materialInstance.init(renderContext);
        this.modelSprite = new SpriteInstance(renderContext, materialInstance);
        this.spawnState = SpawnState.ReadyForSpawn;
    }

    private updateStudioPose(): void {
        if (this.modelStudio === null)
            throw "whoops";

        mat4.copy(this.modelStudio.modelMatrix, this.modelMatrix);
        this.modelStudio.setupPoseFromSequence(this.seqindex, this.seqtime);
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager): void {
        if (this.materialParams !== null)
            colorCopy(this.materialParams.blendColor, this.rendercolor, this.renderamt);

        if (this.modelStudio !== null) {
            this.updateStudioPose();
            this.modelStudio.setSkin(renderContext, this.skin);
            this.modelStudio.prepareToRender(renderContext, renderInstManager);
        } else if (this.modelSprite !== null) {
            this.modelSprite.prepareToRender(renderContext, renderInstManager);
        }

        if ((this as any).debug)
            this.materialParams!.lightCache!.debugDrawLights(renderContext.currentView);
    }

    private getParentModelMatrix(): ReadonlyMat4 {
        if (this.parentAttachment !== null)
            return this.parentEntity!.getAttachmentMatrix(this.parentAttachment);
        else
            return this.parentEntity!.updateModelMatrix();
    }

    public setAbsOrigin(origin: ReadonlyVec3): void {
        if (this.parentEntity !== null) {
            mat4.invert(scratchMat4a, this.getParentModelMatrix());
            transformVec3Mat4w1(this.localOrigin, scratchMat4a, origin);
        } else {
            vec3.copy(this.localOrigin, origin);
        }

        this.updateModelMatrix();
    }

    public setAbsOriginAndAngles(origin: ReadonlyVec3, angles: ReadonlyVec3): void {
        if (this.parentEntity !== null) {
            mat4.invert(scratchMat4a, this.getParentModelMatrix());
            computeModelMatrixPosQAngle(scratchMat4b, origin, angles);
            mat4.mul(scratchMat4b, scratchMat4a, scratchMat4b);
            computePosQAngleModelMatrix(this.localOrigin, this.localAngles, scratchMat4b);
        } else {
            vec3.copy(this.localOrigin, origin);
            vec3.copy(this.localAngles, angles);
        }

        this.updateModelMatrix();
    }

    public getAbsOrigin(dstOrigin: vec3): void {
        if (this.parentEntity !== null) {
            computePosQAngleModelMatrix(dstOrigin, null, this.updateModelMatrix());
        } else {
            vec3.copy(dstOrigin, this.localOrigin);
        }
    }

    public getAbsOriginAndAngles(dstOrigin: vec3, dstAngles: vec3): void {
        if (this.parentEntity !== null) {
            computePosQAngleModelMatrix(dstOrigin, dstAngles, this.updateModelMatrix());
        } else {
            vec3.copy(dstOrigin, this.localOrigin);
            vec3.copy(dstAngles, this.localAngles);
        }
    }

    public setParentEntity(parentEntity: BaseEntity | null, parentAttachment: number | null = null): void {
        // TODO(jstpierre): How is this supposed to work? Happens in infra_c4_m2_furnace...
        if (parentEntity === this) {
            parentEntity = null;
            parentAttachment = null;
        }

        if (parentEntity === this.parentEntity && parentAttachment === this.parentAttachment)
            return;

        if (this.parentEntity !== null)
            arrayRemove(this.parentEntity.childEntity, this);

        // Transform origin into absolute world-space.
        this.getAbsOriginAndAngles(this.localOrigin, this.localAngles);

        this.parentEntity = parentEntity;
        this.parentAttachment = parentAttachment;

        if (this.parentEntity !== null)
            this.parentEntity.childEntity.push(this);

        // Transform origin from world-space into entity space.
        this.setAbsOriginAndAngles(this.localOrigin, this.localAngles);
    }

    public setParentAttachment(attachmentName: string, maintainOffset: boolean) {
        if (this.parentEntity === null)
            return;

        if (this.parentEntity.modelStudio === null)
            return;

        const parentAttachment = this.parentEntity.getAttachmentIndex(attachmentName);
        this.setParentEntity(this.parentEntity, parentAttachment);

        if (!maintainOffset) {
            vec3.zero(this.localOrigin);
            vec3.zero(this.localAngles);
        }
    }

    public getAttachmentIndex(attachmentName: string): number | null {
        if (this.modelStudio === null)
            return null;

        const attachmentIndex = this.modelStudio.modelData.attachment.findIndex((attachment) => attachment.name === attachmentName);
        if (attachmentIndex < 0)
            return null;

        return attachmentIndex;
    }

    public getAttachmentMatrix(attachmentIndex: number): ReadonlyMat4 {
        if (this.modelStudio === null)
            throw "whoops";

        this.updateModelMatrix();
        this.updateStudioPose();
        return this.modelStudio.attachmentMatrix[attachmentIndex];
    }

    public updateModelMatrix(): mat4 {
        computeModelMatrixPosQAngle(this.modelMatrix, this.localOrigin, this.localAngles);

        if (this.parentEntity !== null) {
            const parentModelMatrix = this.parentAttachment !== null ? this.parentEntity.getAttachmentMatrix(this.parentAttachment) : this.parentEntity.updateModelMatrix();
            mat4.mul(this.modelMatrix, parentModelMatrix, this.modelMatrix);
        }

        return this.modelMatrix;
    }

    public movement(entitySystem: EntitySystem, renderContext: SourceRenderContext): void {
        if (this.modelBSP !== null || this.modelStudio !== null) {
            const modelMatrix = this.updateModelMatrix();
            getMatrixTranslation(this.materialParams!.position, modelMatrix);

            let visible = this.shouldDraw();
            if (this.renderamt === 0)
                visible = false;
            if (this.rendermode === 10)
                visible = false;

            if (this.modelBSP !== null) {
                this.modelBSP.visible = visible;
            } else if (this.modelStudio !== null) {
                this.modelStudio.visible = visible;
                this.modelStudio.movement(renderContext);
            }
        }

        if (this.modelStudio !== null) {
            // Update animation state machine.
            if (this.seqplay) {
                const oldSeqTime = this.seqtime;
                this.seqtime += renderContext.globalDeltaTime * this.seqrate;

                if (this.seqtime < 0)
                    this.seqtime = 0;

                // Pass to default animation if we're through.
                if (this.seqdefaultindex >= 0 && this.modelStudio.sequenceIsFinished(this.seqindex, this.seqtime) && !this.holdAnimation)
                    this.playSequenceIndex(this.seqdefaultindex);

                // Handle events.
                const seq = this.modelStudio.modelData.seq[this.seqindex];
                const anim = this.modelStudio.modelData.anim[seq.anim[0]];
                if (anim !== undefined) {
                    const animcyc = anim.fps / anim.numframes;
                    for (let i = 0; i < seq.events.length; i++) {
                        const ev = seq.events[i];
                        if (ev.cycle > (oldSeqTime * animcyc) && ev.cycle <= (this.seqtime * animcyc)) {
                            this.dispatchAnimEvent(entitySystem, ev.event, ev.options);
                        }
                    }
                }
            }
        }

        if ((this as any).debugDraw) {
            let aabb: AABB | null = null;
            if (this.modelBSP !== null)
                aabb = this.modelBSP.model.bbox;
            else if (this.modelStudio !== null)
                aabb = this.modelStudio.modelData.viewBB;

            if (aabb !== null) {
                drawWorldSpaceAABB(getDebugOverlayCanvas2D(), renderContext.currentView.clipFromWorldMatrix, aabb, this.modelMatrix);
            }

            this.getAbsOrigin(scratchVec3a);
            drawWorldSpaceLocator(getDebugOverlayCanvas2D(), renderContext.currentView.clipFromWorldMatrix, scratchVec3a);
        }
    }

    public use(entitySystem: EntitySystem): void {
        // Do nothing by default.
    }

    public destroy(device: GfxDevice): void {
        if (this.modelStudio !== null)
            this.modelStudio.destroy(device);
    }

    protected dispatchAnimEvent(entitySystem: EntitySystem, event: number, options: string): void {
        if (event === 1100) { // SCRIPT_EVENT_FIRE_INPUT
            this.fireInput(entitySystem, options, this, '');
        }
    }

    public getMapData(): BSPEntity {
        return this.entity;
    }

    private input_enable(): void {
        this.enabled = true;
    }

    private input_disable(): void {
        this.enabled = false;
    }

    private input_enabledraw(): void {
        this.visible = true;
    }

    private input_disabledraw(): void {
        this.visible = false;
    }

    private input_kill(): void {
        this.remove();
    }

    private input_killhierarchy(): void {
        this.removeWithChildren();
    }

    private input_use(entitySystem: EntitySystem): void {
        this.use(entitySystem);
    }

    private input_fireuser1(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.output_onuser1.fire(entitySystem, this, activator, value);
    }

    private input_fireuser2(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.output_onuser2.fire(entitySystem, this, activator, value);
    }

    private input_fireuser3(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.output_onuser3.fire(entitySystem, this, activator, value);
    }

    private input_fireuser4(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.output_onuser4.fire(entitySystem, this, activator, value);
    }

    private input_skin(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.skin = Number(value) || 0;
    }

    private input_setparent(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        const parentEntity = entitySystem.findEntityByTargetName(value);
        if (parentEntity !== null)
            this.setParentEntity(parentEntity);
    }

    private input_clearparent(entitySystem: EntitySystem): void {
        this.setParentEntity(null);
    }

    private input_setparentattachment(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.setParentAttachment(value, false);
    }

    private input_setparentattachmentmaintainoffset(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.setParentAttachment(value, true);
    }

    private input_setanimation(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        if (this.modelStudio === null)
            return;

        this.playSequenceIndex(this.findSequenceLabel(value));
    }

    private input_setdefaultanimation(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        if (this.modelStudio === null)
            return;

        this.seqdefaultindex = this.findSequenceLabel(value);
    }

    private input_setplaybackrate(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.seqrate = Number(value);
    }
}

class player extends BaseEntity {
    public currentFogController: env_fog_controller | null = null;
    private currentColorCorrection: color_correction | null = null;

    public lookDir = vec3.create();

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer) {
        super(entitySystem, renderContext, bspRenderer, {
            classname: 'player',
            targetname: '!player',
        });

        this.registerInput('setfogcontroller', this.input_setfogcontroller.bind(this));
    }

    private getMasterFogController(entitySystem: EntitySystem): env_fog_controller | null {
        let master: env_fog_controller | null = entitySystem.findEntityByType(env_fog_controller);

        let nextController = master;
        while (true) {
            nextController = entitySystem.findEntityByType(env_fog_controller, nextController);
            if (nextController === null)
                break;

            // master controller takes priority
            if (nextController.isMaster) {
                master = nextController;
                break;
            }
        }

        return master;
    }

    private getMasterColorCorrection(entitySystem: EntitySystem): color_correction | null {
        let master: color_correction | null = entitySystem.findEntityByType(color_correction);

        let nextController = master;
        while (true) {
            nextController = entitySystem.findEntityByType(color_correction, nextController);
            if (nextController === null)
                break;

            // master controller takes priority
            if (nextController.isMaster) {
                master = nextController;
                break;
            }
        }

        return master;
    }

    public override spawn(entitySystem: EntitySystem): void {
        super.spawn(entitySystem);

        this.currentFogController = this.getMasterFogController(entitySystem);
    }

    public override remove(): void {
        // Don't kill the player.
    }

    private input_setfogcontroller(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.currentFogController = entitySystem.findEntityByTargetName(value) as env_fog_controller;
    }

    private setCurrentColorCorrection(v: color_correction | null): void {
        // TODO(jstpierre): Fade in / out
        if (this.currentColorCorrection !== null)
            this.currentColorCorrection.enabled = false;

        this.currentColorCorrection = v;
        
        if (this.currentColorCorrection !== null)
            this.currentColorCorrection.enabled = true;
    }

    private updateFogVolume(entitySystem: EntitySystem): void {
        let firstVolume: fog_volume | null = entitySystem.findEntityByType(fog_volume);

        // No volumes at all, don't do anything here.
        if (firstVolume === null)
            return;

        for (let volume: fog_volume | null = firstVolume; volume !== null; volume = entitySystem.findEntityByType(fog_volume, volume)) {
            this.getAbsOrigin(scratchVec3a);
            if (volume.contains(scratchVec3a)) {
                this.currentFogController = volume.fogController !== null ? volume.fogController : this.getMasterFogController(entitySystem);
                this.setCurrentColorCorrection(volume.colorCorrection !== null ? volume.colorCorrection : this.getMasterColorCorrection(entitySystem));
                // post-process
                return;
            }
        }

        // Inside nothing, fall back to the master fog controller.
        this.currentFogController = this.getMasterFogController(entitySystem);
        this.setCurrentColorCorrection(this.getMasterColorCorrection(entitySystem));
    }

    public override movement(entitySystem: EntitySystem, renderContext: SourceRenderContext): void {
        super.movement(entitySystem, renderContext);

        const view = renderContext.currentView;
        this.setAbsOrigin(view.cameraPos);
        // Get forward vector
        getMatrixAxisZ(this.lookDir, view.worldFromViewMatrix);
        vec3.negate(this.lookDir, this.lookDir);

        this.updateFogVolume(entitySystem);
    }
}

export class worldspawn extends BaseEntity {
    public static classname = `worldspawn`;
    public detailMaterial: string;
    public skyname: string | undefined;

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);
        this.detailMaterial = fallbackUndefined(this.entity.detailmaterial, `detail/detailsprites`);
        this.skyname = this.entity.skyname;
    }
}

export class sky_camera extends BaseEntity {
    public static classname = `sky_camera`;
    public area: number = -1;
    public scale: number = 1;
    public override modelMatrix = mat4.create();
    private fogEnabled: boolean;
    private fogStart: number;
    private fogEnd: number;
    private fogMaxDensity: number;
    private fogColor1 = colorNewCopy(White);
    private fogColor2 = colorNewCopy(White);
    private fogDirection: number[];

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);
        const leaf = assertExists(bspRenderer.bsp.queryPoint(this.localOrigin));
        this.area = leaf.area;
        this.scale = Number(entity.scale);
        computeModelMatrixSRT(this.modelMatrix, this.scale, this.scale, this.scale, 0, 0, 0,
            this.scale * -this.localOrigin[0],
            this.scale * -this.localOrigin[1],
            this.scale * -this.localOrigin[2]);

        this.fogEnabled = !!Number(this.entity.fogenable);
        vmtParseColor(this.fogColor1, this.entity.fogcolor);
        vmtParseColor(this.fogColor2, this.entity.fogcolor2);
        this.fogDirection = vmtParseVector(this.entity.fogdir);
        this.fogStart = Number(this.entity.fogstart) / this.scale;
        this.fogEnd = Number(this.entity.fogend) / this.scale;
        this.fogMaxDensity = Number(fallbackUndefined(this.entity.fogmaxdensity, '1'));
    }

    public fillFogParams(dst: FogParams): void {
        dst.start = this.fogStart;
        dst.end = this.fogEnd;
        dst.maxdensity = this.fogEnabled ? this.fogMaxDensity : 0;
        // TODO(jstpierre): Color blending
        colorCopy(dst.color, this.fogColor1);
    }
}

class water_lod_control extends BaseEntity {
    public static classname = 'water_lod_control';

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);
        if (entity.cheapwaterstartdistance !== undefined)
            renderContext.cheapWaterStartDistance = Number(entity.cheapwaterstartdistance);
        if (entity.cheapwaterenddistance !== undefined)
            renderContext.cheapWaterEndDistance = Number(entity.cheapwaterenddistance);
    }
}

function angleVec(dstForward: vec3 | null, dstRight: vec3 | null, dstUp: vec3 | null, rot: ReadonlyVec3): void {
    computeModelMatrixPosQAngle(scratchMat4a, Vec3Zero, rot);
    getMatrixAxis(dstForward, dstRight, dstUp, scratchMat4a);
}

const enum ToggleState {
    Top, Bottom, GoingToTop, GoingToBottom,
}

abstract class BaseToggle extends BaseEntity {
    public moveDir = vec3.create();
    public startPosition: number;
    public moveDistance: number;
    public speed: number;

    // Movement code
    protected moveTimeLeftInSeconds = 0.0;
    protected moveType: ('lin' | 'ang' | null) = null;
    protected linMoveTarget = vec3.create();
    protected linVelPerSecond = vec3.create();
    protected angMoveTarget = vec3.create();
    protected angVelPerSecond = vec3.create();

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        vec3.copy(this.moveDir, vmtParseVector(fallbackUndefined(this.entity.movedir, "")) as vec3);
        this.startPosition = Number(fallbackUndefined(this.entity.startposition, '0'));
        this.moveDistance = Number(fallbackUndefined(this.entity.movedistance, '0'));
        this.speed = Number(fallbackUndefined(this.entity.speed, '0'));
    }

    protected linearMove(entitySystem: EntitySystem, linMoveTarget: ReadonlyVec3, speedInSeconds: number): void {
        vec3.copy(this.linMoveTarget, linMoveTarget);
        vec3.copy(this.angMoveTarget, this.localAngles);
        vec3.sub(this.linVelPerSecond, this.linMoveTarget, this.localOrigin);
        this.moveTimeLeftInSeconds = vec3.length(this.linVelPerSecond) / speedInSeconds;
        if (this.moveTimeLeftInSeconds <= 0.0)
            this.moveDone(entitySystem);
        else
            vec3.scale(this.linVelPerSecond, this.linVelPerSecond, 1.0 / this.moveTimeLeftInSeconds);
    }

    protected angularMove(entitySystem: EntitySystem, angMoveTarget: ReadonlyVec3, speedInSeconds: number): void {
        vec3.copy(this.angMoveTarget, angMoveTarget);
        vec3.copy(this.linMoveTarget, this.localOrigin);
        vec3.sub(this.angVelPerSecond, this.angMoveTarget, this.localAngles);
        this.moveTimeLeftInSeconds = vec3.length(this.angVelPerSecond) / speedInSeconds;
        if (this.moveTimeLeftInSeconds <= 0.0)
            this.moveDone(entitySystem);
        else
            vec3.scale(this.angVelPerSecond, this.angVelPerSecond, 1.0 / this.moveTimeLeftInSeconds);
    }

    public override movement(entitySystem: EntitySystem, renderContext: SourceRenderContext): void {
        super.movement(entitySystem, renderContext);

        const deltaTimeInSeconds = renderContext.globalDeltaTime;

        if (this.moveTimeLeftInSeconds > 0.0) {
            // Apply the velocity.
            vec3.scaleAndAdd(this.localOrigin, this.localOrigin, this.linVelPerSecond, deltaTimeInSeconds);
            vec3.scaleAndAdd(this.localAngles, this.localAngles, this.angVelPerSecond, deltaTimeInSeconds);
            this.moveTimeLeftInSeconds -= deltaTimeInSeconds;

            // If we've reached the target position, then we're done.
            if (this.moveTimeLeftInSeconds <= 0.0) {
                vec3.copy(this.localOrigin, this.linMoveTarget);
                vec3.copy(this.localAngles, this.angMoveTarget);
                vec3.zero(this.linVelPerSecond);
                vec3.zero(this.angVelPerSecond);
                this.moveTimeLeftInSeconds = 0.0;
                this.moveDone(entitySystem);
            }
        }
    }

    protected abstract moveDone(entitySystem: EntitySystem): void;
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
class func_movelinear extends BaseToggle {
    public static classname = `func_movelinear`;

    protected positionOpened = vec3.create();
    protected positionClosed = vec3.create();

    private output_onFullyClosed = new EntityOutput();
    private output_onFullyOpen = new EntityOutput();

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.output_onFullyOpen.parse(this.entity.onfullyopen);
        this.output_onFullyClosed.parse(this.entity.onfullyclosed);
        this.registerInput('open', this.input_open.bind(this));
        this.registerInput('close', this.input_close.bind(this));
        this.registerInput('setposition', this.input_setposition.bind(this));
    }

    public override spawn(entitySystem: EntitySystem): void {
        super.spawn(entitySystem);

        angleVec(scratchVec3a, null, null, this.moveDir);
        vec3.scaleAndAdd(this.positionClosed, this.localOrigin, scratchVec3a, -this.moveDistance * this.startPosition);
        vec3.scaleAndAdd(this.positionOpened, this.positionClosed, scratchVec3a, this.moveDistance);
    }

    protected moveDone(entitySystem: EntitySystem): void {
        if (vec3.distance(this.localOrigin, this.positionClosed) < MathConstants.EPSILON)
            this.output_onFullyClosed.fire(entitySystem, this, this);
        if (vec3.distance(this.localOrigin, this.positionOpened) < MathConstants.EPSILON)
            this.output_onFullyOpen.fire(entitySystem, this, this);
    }

    private input_open(entitySystem: EntitySystem): void {
        this.linearMove(entitySystem, this.positionOpened, this.speed);
    }

    private input_close(entitySystem: EntitySystem): void {
        this.linearMove(entitySystem, this.positionClosed, this.speed);
    }

    private input_setposition(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.calcPos(scratchVec3a, Number(value));
        this.linearMove(entitySystem, scratchVec3a, this.speed);
    }

    private calcPos(dst: vec3, t: number): void {
        vec3.lerp(dst, this.positionClosed, this.positionOpened, t);
    }
}

abstract class BaseDoor extends BaseToggle {
    private output_onClose = new EntityOutput();
    private output_onOpen = new EntityOutput();
    private output_onFullyClosed = new EntityOutput();
    private output_onFullyOpen = new EntityOutput();

    private locked = false;
    private wait = -1;
    private waitTimer = 0;
    protected toggleState: ToggleState;

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.output_onClose.parse(this.entity.onclose);
        this.output_onOpen.parse(this.entity.onopen);
        this.output_onFullyClosed.parse(this.entity.onfullyclosed);
        this.output_onFullyOpen.parse(this.entity.onfullyopen);

        this.registerInput('close', this.input_close.bind(this));
        this.registerInput('open', this.input_open.bind(this));
        this.registerInput('toggle', this.input_toggle.bind(this));
        this.registerInput('lock', this.input_lock.bind(this));
        this.registerInput('unlock', this.input_unlock.bind(this));
        this.registerInput('setspeed', this.input_setspeed.bind(this));

        const spawnpos = Number(fallbackUndefined(this.entity.spawnpos, '0'));
        this.wait = Number(fallbackUndefined(this.entity.wait, '-1'));

        const enum SpawnFlags {
            START_OPEN_OBSOLETE = 0x01,
            NO_AUTO_RETURN      = 0x20,
        };
        const spawnflags: SpawnFlags = Number(fallbackUndefined(this.entity.spawnflags, '0'));

        if (spawnflags & SpawnFlags.NO_AUTO_RETURN)
            this.wait = -1;

        if (spawnpos === 1 || !!(spawnflags & SpawnFlags.START_OPEN_OBSOLETE))
            this.toggleState = ToggleState.Top;
        else
            this.toggleState = ToggleState.Bottom;
    }

    public override movement(entitySystem: EntitySystem, renderContext: SourceRenderContext): void {
        super.movement(entitySystem, renderContext);

        if (this.waitTimer > 0) {
            this.waitTimer -= renderContext.globalDeltaTime;

            if (this.waitTimer <= 0) {
                this.goToBottom(entitySystem);
            }
        }
    }

    private activate(entitySystem: EntitySystem): void {
        if (this.toggleState === ToggleState.Top)
            this.goToBottom(entitySystem);
        else if (this.toggleState === ToggleState.Bottom || this.toggleState === ToggleState.GoingToBottom)
            this.goToTop(entitySystem);
    }

    public override use(entitySystem: EntitySystem): void {
        let allowUse = false;

        // TODO(jstpierre): SF_DOOR_NEW_USE_RULES
        if (this.toggleState === ToggleState.Bottom)
            allowUse = true;

        if (allowUse) {
            if (this.locked)
                return;

            this.activate(entitySystem);
        }
    }

    protected abstract moveToOpened(entitySystem: EntitySystem): void;
    protected abstract moveToClosed(entitySystem: EntitySystem): void;

    private goToTop(entitySystem: EntitySystem): void {
        this.toggleState = ToggleState.GoingToTop;
        this.waitTimer = 0;
        this.moveToOpened(entitySystem);
        this.output_onOpen.fire(entitySystem, this, this);
    }

    private goToBottom(entitySystem: EntitySystem): void {
        this.toggleState = ToggleState.GoingToBottom;
        this.waitTimer = 0;
        this.moveToClosed(entitySystem);
        this.output_onClose.fire(entitySystem, this, this);
    }

    private hitTop(entitySystem: EntitySystem): void {
        this.output_onFullyOpen.fire(entitySystem, this, this);

        if (this.wait > 0) {
            this.waitTimer = this.wait;
        }
    }

    private hitBottom(entitySystem: EntitySystem): void {
        this.output_onFullyClosed.fire(entitySystem, this, this);
    }

    protected moveDone(entitySystem: EntitySystem): void {
        if (this.toggleState === ToggleState.GoingToTop)
            this.hitTop(entitySystem);
        else if (this.toggleState === ToggleState.GoingToBottom)
            this.hitBottom(entitySystem);
    }

    private input_close(entitySystem: EntitySystem): void {
        if (this.toggleState === ToggleState.Bottom)
            return;

        this.goToBottom(entitySystem);
    }

    private input_open(entitySystem: EntitySystem): void {
        if (this.toggleState === ToggleState.Top || this.toggleState === ToggleState.GoingToTop)
            return;

        if (this.locked)
            return;

        this.goToTop(entitySystem);
    }

    private input_toggle(entitySystem: EntitySystem): void {
        if (this.locked)
            return;

        if (this.toggleState === ToggleState.Top)
            this.goToTop(entitySystem);
        else if (this.toggleState === ToggleState.Bottom)
            this.goToBottom(entitySystem);
    }

    private input_setspeed(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.speed = Number(value);
    }

    private input_lock(entitySystem: EntitySystem): void {
        this.locked = true;
    }

    private input_unlock(entitySystem: EntitySystem): void {
        this.locked = false;
    }
}

const scratchAABB = new AABB();
class func_door extends BaseDoor {
    public static classname = `func_door`;

    private modelExtents = vec3.create();
    private lip: number;

    protected positionOpened = vec3.create();
    protected positionClosed = vec3.create();

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);
        this.lip = Number(fallbackUndefined(this.entity.lip, '0'));
    }

    public override spawn(entitySystem: EntitySystem): void {
        super.spawn(entitySystem);

        vec3.copy(this.positionOpened, this.localOrigin);
        vec3.copy(this.positionClosed, this.localOrigin);

        this.updateExtents();
    }

    private updateExtents(): void {
        computeModelMatrixPosQAngle(scratchMat4a, Vec3Zero, this.localAngles);
        if (this.modelBSP !== null)
            scratchAABB.transform(this.modelBSP.model.bbox, scratchMat4a);
        else if (this.modelStudio !== null)
            scratchAABB.transform(this.modelStudio.modelData.viewBB, scratchMat4a);
        scratchAABB.extents(this.modelExtents);

        angleVec(scratchVec3a, null, null, this.moveDir);
        const moveDistance = Math.abs(vec3.dot(scratchVec3a, this.modelExtents) * 2.0) - this.lip;
        vec3.scaleAndAdd(this.positionOpened, this.positionClosed, scratchVec3a, moveDistance);

        if (this.toggleState === ToggleState.Top) {
            // If we should start open, then start open.
            vec3.copy(this.localOrigin, this.positionOpened);
        }
    }

    protected moveToOpened(entitySystem: EntitySystem): void {
        this.linearMove(entitySystem, this.positionOpened, this.speed);
    }

    protected moveToClosed(entitySystem: EntitySystem): void {
        this.linearMove(entitySystem, this.positionClosed, this.speed);
    }
}

class func_door_rotating extends BaseDoor {
    public static classname = `func_door_rotating`;

    protected anglesOpened = vec3.create();
    protected anglesClosed = vec3.create();

    public override spawn(entitySystem: EntitySystem): void {
        super.spawn(entitySystem);

        const enum SpawnFlags {
            ROTATE_BACKWARDS = 0x02,
            ROTATE_ROLL      = 0x40,
            ROTATE_PITCH     = 0x80,
        };
        const spawnflags: SpawnFlags = Number(fallbackUndefined(this.entity.spawnflags, '0'));

        let rotAngles: ReadonlyVec3;
        if (!!(spawnflags & SpawnFlags.ROTATE_ROLL))
            rotAngles = Vec3UnitZ;
        else if (!!(spawnflags & SpawnFlags.ROTATE_PITCH))
            rotAngles = Vec3UnitX;
        else
            rotAngles = Vec3UnitY;

        let distance = Number(fallbackUndefined(this.entity.distance, '0'));
        if (!!(spawnflags & SpawnFlags.ROTATE_BACKWARDS))
            distance *= -1.0;

        vec3.copy(this.anglesClosed, this.localAngles);
        vec3.scaleAndAdd(this.anglesOpened, this.localAngles, rotAngles, distance);

        if (this.toggleState === ToggleState.Top) {
            // If we should start open, then start open.
            vec3.copy(this.localAngles, this.anglesOpened);
        }
    }

    protected moveToOpened(entitySystem: EntitySystem): void {
        this.angularMove(entitySystem, this.anglesOpened, this.speed);
    }

    protected moveToClosed(entitySystem: EntitySystem): void {
        this.angularMove(entitySystem, this.anglesClosed, this.speed);
    }
}

function signBiasPositive(v: number): number {
    return v >= 0.0 ? 1 : -1;
}

function clampOnEdge(from: number, to: number, target: number): number {
    if (target >= 0 === from <= target) {
        if (from <= target && to >= target)
            return target;
    } else {
        if (from >= target && to <= target)
            return target;
    }

    return to;
}

class func_rotating extends BaseEntity {
    public static classname = `func_rotating`;

    private output_ongetspeed = new EntityOutput();

    private friction = 1;
    private maxSpeed: number = 0;

    private useAcceleration = false;
    private rotAngles = vec3.create();
    private speed = 0.0;
    private targetSpeed = 0.0;
    private reversed = false;
    protected angVelPerSecond = vec3.create();

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.registerInput('setspeed', this.input_setspeed.bind(this));
        this.registerInput('getspeed', this.input_getspeed.bind(this));
        this.registerInput('start', this.input_start.bind(this));
        this.registerInput('stop', this.input_stop.bind(this));
        this.registerInput('toggle', this.input_toggle.bind(this));
        this.registerInput('reverse', this.input_reverse.bind(this));
        this.registerInput('startforward', this.input_startforward.bind(this));
        this.registerInput('startbackward', this.input_startbackward.bind(this));
        this.output_ongetspeed.parse(this.entity.ongetspeed);
    }

    public override spawn(entitySystem: EntitySystem): void {
        super.spawn(entitySystem);

        this.friction = Math.max(Number(fallbackUndefined(this.entity.fanfriction, '0')), 1);

        this.maxSpeed = Number(fallbackUndefined(this.entity.maxspeed, '0'));
        if (this.maxSpeed === 0)
            this.maxSpeed = 100;

        const enum SpawnFlags {
            ROTATE_START_ON  = 0x01,
            ROTATE_BACKWARDS = 0x02,
            ROTATE_Z_AXIS    = 0x04,
            ROTATE_X_AXIS    = 0x08,
            ACCDCC           = 0x10,
        };
        const spawnflags: SpawnFlags = Number(fallbackUndefined(this.entity.spawnflags, '0'));

        if (!!(spawnflags & SpawnFlags.ROTATE_Z_AXIS))
            vec3.copy(this.rotAngles, Vec3UnitZ);
        else if (!!(spawnflags & SpawnFlags.ROTATE_X_AXIS))
            vec3.copy(this.rotAngles, Vec3UnitX);
        else
            vec3.copy(this.rotAngles, Vec3UnitY);

        if (!!(spawnflags & SpawnFlags.ROTATE_BACKWARDS))
            vec3.negate(this.rotAngles, this.rotAngles);

        this.useAcceleration = !!(spawnflags & SpawnFlags.ACCDCC);

        if (!!(spawnflags & SpawnFlags.ROTATE_START_ON))
            this.toggle();
    }

    public override movement(entitySystem: EntitySystem, renderContext: SourceRenderContext): void {
        super.movement(entitySystem, renderContext);

        if (this.useAcceleration && this.targetSpeed !== this.speed) {
            // Apply acceleration logic.

            let isChangingDirections = (signBiasPositive(this.targetSpeed) !== signBiasPositive(this.speed));

            // Spinning to/from zero is never considered changing directions.
            if (this.speed === 0.0 || this.targetSpeed === 0.0)
                isChangingDirections = false;

            let effectiveTargetSpeed = Math.abs(this.targetSpeed);
            if (isChangingDirections) {
                // If we're changing directions, first spin down to zero before spinning back up.
                effectiveTargetSpeed = 0;
            }

            const absCurSpeed = Math.abs(this.speed);

            const spinUpSpeed = 0.2, spinDownSpeed = -0.1;
            const spinSpeed = effectiveTargetSpeed > absCurSpeed ? spinUpSpeed : spinDownSpeed;

            let newSpeed = this.speed + spinSpeed * this.maxSpeed * this.friction * signBiasPositive(this.targetSpeed);
            newSpeed = clampOnEdge(this.speed, newSpeed, this.targetSpeed);

            this.setSpeed(newSpeed);
        }

        const deltaTimeInSeconds = renderContext.globalDeltaTime;
        vec3.scaleAndAdd(this.localAngles, this.localAngles, this.angVelPerSecond, deltaTimeInSeconds);
    }

    private setSpeed(speed: number): void {
        this.speed = clamp(speed, -this.maxSpeed, this.maxSpeed);
        vec3.scale(this.angVelPerSecond, this.rotAngles, speed);
    }

    private setTargetSpeed(targetSpeed: number): void {
        this.targetSpeed = Math.abs(targetSpeed) * (this.reversed ? -1 : 1);

        if (!this.useAcceleration) {
            // In the case we're not using acceleration, just set the new speed immediately.
            this.setSpeed(this.targetSpeed);
        }
    }

    private toggle(): void {
        if (this.speed !== 0) {
            this.setTargetSpeed(0);
        } else {
            this.setTargetSpeed(this.maxSpeed);
        }
    }

    private input_setspeed(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        const speed = Number(value);
        this.setSpeed(speed);
    }

    private input_getspeed(entitySystem: EntitySystem, activator: BaseEntity): void {
        this.output_ongetspeed.fire(entitySystem, this, activator, '' + this.speed);
    }

    private input_start(entitySystem: EntitySystem): void {
        this.setTargetSpeed(this.maxSpeed);
    }

    private input_stop(entitySystem: EntitySystem): void {
        this.setTargetSpeed(0);
    }

    private input_toggle(entitySystem: EntitySystem): void {
        this.toggle();
    }

    private input_reverse(entitySystem: EntitySystem): void {
        this.reversed = !this.reversed;
        this.setTargetSpeed(this.speed);
    }

    private input_startforward(entitySystem: EntitySystem): void {
        this.reversed = false;
        this.setTargetSpeed(this.maxSpeed);
    }

    private input_startbackward(entitySystem: EntitySystem): void {
        this.reversed = true;
        this.setTargetSpeed(this.maxSpeed);
    }
}

class path_track extends BaseEntity {
    public static classname = `path_track`;

    public nextPath: path_track | null = null;
    public previousPath: path_track | null = null;
    public altPath: path_track | null = null;
    public speed = 0.0;
    public radius = 0.0;
    public orientationtype = 0;

    private output_onpass = new EntityOutput();
    private output_onteleport = new EntityOutput();

    private pathEnabled = false;
    private altEnabled = false;
    private altReverse = false;

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.registerInput('togglepath', this.input_togglepath.bind(this));
        this.registerInput('enablepath', this.input_enablepath.bind(this));
        this.registerInput('disablepath', this.input_disablepath.bind(this));
        this.registerInput('togglealternatepath', this.input_togglealternatepath.bind(this));
        this.registerInput('enablealternatepath', this.input_enablealternatepath.bind(this));
        this.registerInput('disablealternatepath', this.input_disablealternatepath.bind(this));

        this.output_onpass.parse(this.entity.onpass);
        this.output_onteleport.parse(this.entity.onteleport);
    }

    public override spawn(entitySystem: EntitySystem): void {
        super.spawn(entitySystem);

        const enum SpawnFlags {
            DISABLED      = 0x0001,
            ALTREVERSE    = 0x0004,
            DISABLE_TRAIN = 0x0008,
            TELEPORT      = 0x0010,
            ALTERNATE     = 0x8000,
        };
        const spawnflags: SpawnFlags = Number(fallbackUndefined(this.entity.spawnflags, '0'));
        this.pathEnabled = !(spawnflags & SpawnFlags.DISABLED);
        this.altEnabled = !!(spawnflags & SpawnFlags.ALTERNATE);
        this.altReverse = !!(spawnflags & SpawnFlags.ALTREVERSE);

        if (this.entity.target) {
            const entity = entitySystem.findEntityByTargetName(this.entity.target);
            if (entity instanceof path_track) {
                this.nextPath = entity;
                this.nextPath.previousPath = this;
            }
        }

        if (this.entity.altpath) {
            const entity = entitySystem.findEntityByTargetName(this.entity.altpath);
            if (entity instanceof path_track) {
                this.altPath = entity;
                this.altPath.previousPath = this;
            }
        }

        this.speed = Number(fallbackUndefined(this.entity.speed, '0'));
        this.radius = Number(fallbackUndefined(this.entity.radius, '0'));
        this.orientationtype = Number(fallbackUndefined(this.entity.orientationtype, '0'));
    }

    public isValid(): boolean {
        return this.pathEnabled;
    }

    public getNextPath(): path_track | null {
        if (this.altPath !== null && this.altEnabled && !this.altReverse)
            return this.altPath;

        return this.nextPath;
    }

    public getPreviousPath(): path_track | null {
        if (this.altPath !== null && this.altEnabled && this.altReverse)
            return this.altPath;

        return this.previousPath;
    }

    private input_togglepath(entitySystem: EntitySystem): void {
        this.pathEnabled = !this.pathEnabled;
    }

    private input_enablepath(entitySystem: EntitySystem): void {
        this.pathEnabled = true;
    }

    private input_disablepath(entitySystem: EntitySystem): void {
        this.pathEnabled = false;
    }

    private input_togglealternatepath(entitySystem: EntitySystem): void {
        this.altEnabled = !this.altEnabled;
    }

    private input_enablealternatepath(entitySystem: EntitySystem): void {
        this.altEnabled = true;
    }

    private input_disablealternatepath(entitySystem: EntitySystem): void {
        this.altEnabled = false;
    }

    public onPass(entitySystem: EntitySystem, activator: BaseEntity): void {
        this.output_onpass.fire(entitySystem, this, activator);
    }

    public onTeleport(entitySystem: EntitySystem, activator: BaseEntity): void {
        this.output_onteleport.fire(entitySystem, this, activator);
    }
}

class func_tracktrain extends BaseEntity {
    public static classname = `func_tracktrain`;

    private startSpeed = 0.0;
    private speed = 0.0;
    private velocityType = 0;
    private orientationType = 0;
    private length = 0.0;
    private height = 0.0;

    private output_onstart = new EntityOutput();

    private currentPath: path_track;
    private waitTime = 0.0;
    private activated = false;

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.registerInput('setspeed', this.input_setspeed.bind(this));
        this.registerInput('toggle', this.input_toggle.bind(this));
        this.registerInput('startforward', this.input_startforward.bind(this));
        this.registerInput('startbackward', this.input_startbackward.bind(this));
        this.registerInput('stop', this.input_stop.bind(this));
        this.output_onstart.parse(this.entity.onstart);
    }

    public override spawn(entitySystem: EntitySystem): void {
        super.spawn(entitySystem);

        this.currentPath = assertExists(entitySystem.findEntityByTargetName(this.entity.target) as path_track);
        this.velocityType = Number(fallbackUndefined(this.entity.velocitytype, '0'));
        this.orientationType = Number(fallbackUndefined(this.entity.orientationtype, '0'));
        this.length = Number(fallbackUndefined(this.entity.wheels, '0'));
        this.height = Number(fallbackUndefined(this.entity.height, '0'));
        this.speed = Number(fallbackUndefined(this.entity.speed, '0'));
        this.startSpeed = Number(fallbackUndefined(this.entity.startspeed, '0'));
    }

    private setCurrentPath(entitySystem: EntitySystem, path: path_track): void {
        this.currentPath = path;
        this.currentPath.onPass(entitySystem, this);
        if (this.currentPath.speed !== 0.0)
            this.speed = this.currentPath.speed;
    }

    public override movement(entitySystem: EntitySystem, renderContext: SourceRenderContext): void {
        super.movement(entitySystem, renderContext);

        if (!this.activated) {
            vec3.copy(this.localOrigin, this.currentPath.localOrigin);
            this.localOrigin[2] += this.height;

            this.setCurrentPath(entitySystem, this.currentPath);
            this.activated = true;
        }

        if (this.waitTime > 0.0)
            this.waitTime -= renderContext.globalDeltaTime;

        if (this.waitTime <= 0.0 && this.speed !== 0.0) {
            // Moving along the path.
            let distanceToMove = Math.abs(this.speed * renderContext.globalDeltaTime);

            while (true) {
                const nextPath = this.speed > 0.0 ? this.currentPath.getNextPath() : this.currentPath.getPreviousPath();

                if (nextPath === null || !nextPath.isValid()) {
                    // Dead end ourselves.
                    this.speed = 0.0;
                    break;
                }

                vec3.sub(scratchVec3a, nextPath.localOrigin, this.currentPath.localOrigin);
                vec3.sub(scratchVec3b, this.localOrigin, this.currentPath.localOrigin);
                const pathDist = vec3.length(scratchVec3a);
                vec3.normalize(scratchVec3a, scratchVec3a);

                const oldCoord = vec3.dot(scratchVec3a, scratchVec3b);
                const newCoord = oldCoord + Math.abs(distanceToMove);

                if (newCoord >= pathDist) {
                    // We passed a node, notify it and then hunt for the remainder.
                    distanceToMove -= (pathDist - oldCoord);
                    this.setCurrentPath(entitySystem, nextPath);
                    continue;
                }

                // Current position is within the bounds; done.
                vec3.scaleAndAdd(this.localOrigin, this.currentPath.localOrigin, scratchVec3a, newCoord);
                this.localOrigin[2] += this.height;
                break;
            }
        }
    }

    private start(entitySystem: EntitySystem): void {
        this.output_onstart.fire(entitySystem, this, this);
    }

    private setSpeed(entitySystem: EntitySystem, speed: number): void {
        const oldSpeed = this.speed;
        this.speed = speed;

        if (speed !== oldSpeed) {
            if (oldSpeed === 0.0)
                this.start(entitySystem);
        }
    }

    private input_setspeed(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        const speed = Number(value);
        this.setSpeed(entitySystem, speed);
    }

    private input_toggle(entitySystem: EntitySystem): void {
        this.setSpeed(entitySystem, this.speed !== 0.0 ? 0.0 : this.startSpeed);
    }

    private input_startforward(entitySystem: EntitySystem): void {
        this.setSpeed(entitySystem, this.startSpeed);
    }

    private input_startbackward(entitySystem: EntitySystem): void {
        this.setSpeed(entitySystem, -this.startSpeed);
    }

    private input_stop(entitySystem: EntitySystem): void {
        this.setSpeed(entitySystem, 0.0);
    }
}

class func_areaportalwindow extends BaseEntity {
    public static classname = `func_areaportalwindow`;

    public override spawn(entitySystem: EntitySystem): void {
        super.spawn(entitySystem);

        // We don't support areaportals yet, so just hide the replacement target entity.
        const targetName = this.entity.target;
        if (targetName) {
            const targetEntity = entitySystem.findEntityByTargetName(this.entity.target);
            if (targetEntity !== null)
                targetEntity.visible = false;
        }
    }
}

class func_instance_io_proxy extends BaseEntity {
    public static classname = `func_instance_io_proxy`;

    private output_onProxyRelay: EntityOutput[] = [];

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        const numProxies = 30;
        for (let i = 1; i <= numProxies; i++) {
            const output = new EntityOutput();
            this.output_onProxyRelay.push(output);
            const ioName = `onproxyrelay${i}`;
            output.parse(this.entity[ioName]);
            this.registerInput(ioName, (entitySystem: EntitySystem, activator: BaseEntity) => {
                output.fire(entitySystem, this, activator);
            });
        }
    }
}

class logic_auto extends BaseEntity {
    public static classname = `logic_auto`;

    private output_onMapSpawn = new EntityOutput();

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.output_onMapSpawn.parse(this.entity.onmapspawn);
    }

    public override spawn(entitySystem: EntitySystem): void {
        super.spawn(entitySystem);
        this.output_onMapSpawn.fire(entitySystem, this, this);
    }
}

class logic_relay extends BaseEntity {
    public static classname = `logic_relay`;

    private output_onTrigger = new EntityOutput();
    private output_onSpawn = new EntityOutput();

    private removeOnFire = false;
    private allowFastRetrigger = false;
    private waitingForEnableRefire = false;

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        const enum SpawnFlags {
            RemoveOnFire = 0x01,
            AllowFastRetrigger = 0x02,
        };
        const spawnflags: SpawnFlags = Number(this.entity.spawnflags);
        this.removeOnFire = !!(spawnflags & SpawnFlags.RemoveOnFire);
        this.allowFastRetrigger = !!(spawnflags & SpawnFlags.AllowFastRetrigger);

        this.output_onTrigger.parse(this.entity.ontrigger);
        this.output_onSpawn.parse(this.entity.onspawn);
        this.registerInput('trigger', this.input_trigger.bind(this));
        this.registerInput('cancelpending', this.input_cancelpending.bind(this));
        this.registerInput('enablerefire', this.input_enablerefire.bind(this));
    }

    public override spawn(entitySystem: EntitySystem): void {
        super.spawn(entitySystem);

        this.output_onSpawn.fire(entitySystem, this, this);

        if (this.output_onSpawn.hasAnyActions() && this.removeOnFire)
            this.remove();
    }

    private input_trigger(entitySystem: EntitySystem, activator: BaseEntity): void {
        if (!this.enabled)
            return;

        if (this.waitingForEnableRefire)
            return;

        this.output_onTrigger.fire(entitySystem, this, activator);
        if (this.removeOnFire)
            this.remove();

        if (!this.allowFastRetrigger) {
            const targetName = assertExists(this.targetName);
            entitySystem.queueOutputEvent({ targetName, inputName: 'enablerefire', parameterOverride: '', delay: 0.001, timesToFire: 1 }, this, activator, '');
            this.waitingForEnableRefire = true;
        }
    }

    private input_enablerefire(entitySystem: EntitySystem): void {
        this.waitingForEnableRefire = false;
    }

    private input_cancelpending(entitySystem: EntitySystem): void {
        entitySystem.cancelOutputEventsForSender(this);
    }
}

class logic_branch extends BaseEntity {
    public static classname = `logic_branch`;

    private value: boolean;
    private output_onTrue = new EntityOutput();
    private output_onFalse = new EntityOutput();

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.value = this.parseValue(this.entity.initialvalue);
        this.registerInput('setvalue', this.input_setvalue.bind(this));
        this.registerInput('setvaluetest', this.input_setvaluetest.bind(this));
        this.registerInput('toggle', this.input_toggle.bind(this));
        this.registerInput('toggletest', this.input_toggletest.bind(this));
        this.registerInput('test', this.input_test.bind(this));
        this.output_onTrue.parse(this.entity.ontrue);
        this.output_onFalse.parse(this.entity.onfalse);
    }

    private parseValue(value: string): boolean {
        return !!Number(value);
    }

    private setValue(entitySystem: EntitySystem, value: boolean, shouldFire: boolean): void {
        if (this.value !== value) {
            this.value = value;
        }

        if (shouldFire) {
            if (this.value)
                this.output_onTrue.fire(entitySystem, this, this);
            else
                this.output_onFalse.fire(entitySystem, this, this);
        }
    }

    private input_setvalue(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.setValue(entitySystem, this.parseValue(value), false);
    }

    private input_setvaluetest(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.setValue(entitySystem, this.parseValue(value), true);
    }

    private input_toggle(entitySystem: EntitySystem): void {
        this.setValue(entitySystem, !this.value, false);
    }

    private input_toggletest(entitySystem: EntitySystem): void {
        this.setValue(entitySystem, !this.value, true);
    }

    private input_test(entitySystem: EntitySystem): void {
        this.setValue(entitySystem, this.value, true);
    }
}

function swap<T>(L: T[], i: number, j: number): void {
    const t = L[i];
    L[i] = L[j];
    L[j] = t;
}

function shuffle<T>(src: T[]): T[] {
    const L = src.slice();

    // Fisher-Yates
    for (let i = L.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        swap(L, i, j);
    }

    return L;
}

class logic_case extends BaseEntity {
    public static classname = `logic_case`;

    private output_oncaseNN = nArray(16, () => new EntityOutput());
    private caseNN: number[] = [];
    private connectedOutputs: number[] = [];
    private shuffled: number[] = [];

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        for (let i = 0; i < 16; i++) {
            const idxStr = leftPad('' + (i + 1), 2);
            const oncase = this.entity[`oncase${idxStr}`];
            if (oncase === undefined)
                continue;

            this.output_oncaseNN[i].parse(oncase);

            const case_ = this.entity[`case${idxStr}`];
            const caseNum = case_ !== undefined ? Number(case_) : i;
            this.caseNN.push(caseNum);

            this.connectedOutputs.push(i);
        }

        this.registerInput('invalue', this.input_invalue.bind(this));
        this.registerInput('pickrandom', this.input_pickrandom.bind(this));
        this.registerInput('pickrandomshuffle', this.input_pickrandomshuffle.bind(this));
    }

    private input_invalue(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        const idx = this.caseNN.indexOf(Number(value));
        if (idx < 0)
            return;

        const c = this.connectedOutputs[idx];
        this.output_oncaseNN[c].fire(entitySystem, this, activator);
    }

    private input_pickrandom(entitySystem: EntitySystem, activator: BaseEntity): void {
        const index = (Math.random() * this.connectedOutputs.length) | 0;
        const c = this.connectedOutputs[index];
        this.output_oncaseNN[c].fire(entitySystem, this, activator);
    }

    private input_pickrandomshuffle(entitySystem: EntitySystem, activator: BaseEntity): void {
        if (this.shuffled.length === 0)
            this.shuffled = shuffle(this.connectedOutputs);
        const c = this.shuffled.pop()!;
        this.output_oncaseNN[c].fire(entitySystem, this, activator);
    }
}

class logic_timer extends BaseEntity {
    public static classname = `logic_timer`;

    private refiretime: number = 0;
    private nextFireTime: number = 0;
    private useRandomTime: boolean = false;
    private lowerRandomBound: number = 0;
    private upperRandomBound: number = 0;

    private output_onTimer = new EntityOutput();

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.output_onTimer.parse(this.entity.ontimer);
        this.refiretime = Number(fallbackUndefined(this.entity.refiretime, '5'));
        this.useRandomTime = fallbackUndefined(this.entity.userandomtime, '0') !== '0';
        this.lowerRandomBound = Number(fallbackUndefined(this.entity.lowerrandombound, '0'));
        this.upperRandomBound = Number(fallbackUndefined(this.entity.upperrandombound, '5'));

        this.registerInput(`resettimer`, this.input_resettimer.bind(this));
        this.registerInput(`firetimer`, this.input_firetimer.bind(this));
    }

    private reset(entitySystem: EntitySystem): void {
        if (this.useRandomTime)
            this.refiretime = randomRange(this.lowerRandomBound, this.upperRandomBound);
        this.nextFireTime = entitySystem.currentTime + this.refiretime;
    }

    private fireTimer(entitySystem: EntitySystem, activator: BaseEntity): void {
        this.output_onTimer.fire(entitySystem, this, activator);
        this.reset(entitySystem);
    }

    private input_resettimer(entitySystem: EntitySystem): void {
        this.reset(entitySystem);
    }

    private input_firetimer(entitySystem: EntitySystem, activator: BaseEntity): void {
        this.fireTimer(entitySystem, activator);
    }

    public override movement(entitySystem: EntitySystem, renderContext: SourceRenderContext): void {
        super.movement(entitySystem, renderContext);

        if (!this.enabled)
            return;

        if (entitySystem.currentTime >= this.nextFireTime)
            this.fireTimer(entitySystem, this);
    }
}

class logic_compare extends BaseEntity {
    public static classname = `logic_compare`;

    private compareValue: number = -1;
    private value: number = -1;

    private output_onEqualTo = new EntityOutput();
    private output_onNotEqualTo = new EntityOutput();
    private output_onGreaterThan = new EntityOutput();
    private output_onLessThan = new EntityOutput();

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.value = vmtParseNumber(this.entity.initialvalue, -1);
        this.compareValue = vmtParseNumber(this.entity.comparevalue, -1);

        this.output_onEqualTo.parse(this.entity.onequalto);
        this.output_onNotEqualTo.parse(this.entity.onnotequalto);
        this.output_onGreaterThan.parse(this.entity.ongreaterthan);
        this.output_onLessThan.parse(this.entity.onlessthan);

        this.registerInput('setvalue', this.input_setvalue.bind(this));
        this.registerInput('setvaluecompare', this.input_setvaluecompare.bind(this));
        this.registerInput('setcomparevalue', this.input_setcomparevalue.bind(this));
        this.registerInput('compare', this.input_compare.bind(this));
    }

    private compare(entitySystem: EntitySystem, activator: BaseEntity): void {
        if (this.value === this.compareValue) {
            this.output_onEqualTo.fire(entitySystem, this, activator);
        } else {
            this.output_onNotEqualTo.fire(entitySystem, this, activator);
            if (this.value > this.compareValue)
                this.output_onGreaterThan.fire(entitySystem, this, activator);
            else
                this.output_onLessThan.fire(entitySystem, this, activator);
        }
    }

    private input_setvalue(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.value = Number(value);
    }

    private input_setvaluecompare(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.value = Number(value);
        this.compare(entitySystem, activator);
    }

    private input_setcomparevalue(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.compareValue = Number(value);
    }

    private input_compare(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.compare(entitySystem, activator);
    }
}

class math_counter extends BaseEntity {
    public static classname = `math_counter`;

    private min = 0;
    private max = 0;
    private value = 0;

    private minEdgeState: boolean = false;
    private maxEdgeState: boolean = false;

    private output_outValue = new EntityOutput();
    private output_outGetValue = new EntityOutput();
    private output_onHitMin = new EntityOutput();
    private output_onHitMax = new EntityOutput();

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.output_outValue.parse(this.entity.outvalue);
        this.output_outGetValue.parse(this.entity.outgetvalue);
        this.output_onHitMin.parse(this.entity.onhitmin);
        this.output_onHitMax.parse(this.entity.onhitmax);
        this.registerInput('add', this.input_add.bind(this));
        this.registerInput('subtract', this.input_subtract.bind(this));
        this.registerInput('setvalue', this.input_setvalue.bind(this));
        this.registerInput('setvaluenofire', this.input_setvaluenofire.bind(this));
        this.registerInput('getvalue', this.input_getvalue.bind(this));

        this.value = Number(fallbackUndefined(this.entity.startvalue, '0'));
        this.min = Number(fallbackUndefined(this.entity.min, '0'));
        this.max = Number(fallbackUndefined(this.entity.max, '0'));
    }

    private input_add(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        const num = Number(value);
        this.updateValue(entitySystem, activator, this.value + num);
    }

    private input_subtract(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        const num = Number(value);
        this.updateValue(entitySystem, activator, this.value - num);
    }

    private input_setvalue(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        const num = Number(value);
        this.updateValue(entitySystem, activator, num);
    }

    private input_setvaluenofire(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        let num = Number(value);
        if (this.min !== 0 || this.max !== 0)
            num = clamp(num, this.min, this.max);
        this.value = num;
    }

    private input_getvalue(entitySystem: EntitySystem, activator: BaseEntity): void {
        this.output_outGetValue.fire(entitySystem, this, activator, '' + this.value);
    }

    private updateValue(entitySystem: EntitySystem, activator: BaseEntity, v: number): void {
        this.value = v;

        if (this.min !== 0 || this.max !== 0) {
            if (this.value >= this.max) {
                this.value = this.max;
                if (!this.maxEdgeState) {
                    this.output_onHitMax.fire(entitySystem, this, activator);
                    this.maxEdgeState = true;
                }
            } else {
                this.maxEdgeState = false;
            }

            if (this.value <= this.min) {
                this.value = this.min;
                if (!this.minEdgeState) {
                    this.output_onHitMin.fire(entitySystem, this, activator);
                    this.minEdgeState = true;
                }
            } else {
                this.minEdgeState = false;
            }
        }

        this.output_outValue.fire(entitySystem, this, activator, '' + this.value);
    }
}

class math_remap extends BaseEntity {
    public static classname = `math_remap`;

    private ignoreOutOfRange: boolean;
    private clampOutputToRange: boolean;
    private inMin: number;
    private inMax: number;
    private outMin: number;
    private outMax: number;

    private output_outValue = new EntityOutput();

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.output_outValue.parse(this.entity.outvalue);
        this.registerInput('invalue', this.input_invalue.bind(this));

        const enum SpawnFlags {
            IgnoreOutOfRange   = 0x01,
            ClampOutputToRange = 0x02,
        }
        const spawnflags: SpawnFlags = Number(fallbackUndefined(this.entity.spawnflags, '0'));

        this.ignoreOutOfRange = !!(spawnflags & SpawnFlags.IgnoreOutOfRange);
        this.clampOutputToRange = !!(spawnflags & SpawnFlags.ClampOutputToRange);

        const in1 = Number(fallbackUndefined(this.entity.in1, '0'));
        const in2 = Number(fallbackUndefined(this.entity.in2, '0'));
        const out1 = Number(fallbackUndefined(this.entity.out1, '0'));
        const out2 = Number(fallbackUndefined(this.entity.out2, '0'));

        this.inMin = Math.min(in1, in2);
        this.inMax = Math.max(in1, in2);

        // Avoid divide by zero
        if (this.inMin === this.inMax) {
            this.inMin = 0;
            this.inMax = 1;
        }

        this.outMin = out1;
        this.outMax = out2;
    }

    private input_invalue(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        const num = Number(value);

        let t = invlerp(this.inMin, this.inMax, num);
        if (!this.ignoreOutOfRange) {
            if (t <= 0.0)
                return;
            if (t >= 0.0)
                return;
        }
        if (this.clampOutputToRange)
            t = saturate(t);

        const n = lerp(this.outMin, this.outMax, t);
        this.output_outValue.fire(entitySystem, this, activator, '' + n);
    }
}

const scratchColor = colorNewCopy(White);
class math_colorblend extends BaseEntity {
    public static classname = `math_colorblend`;

    private ignoreOutOfRange: boolean;
    private inMin: number;
    private inMax: number;
    private outColorMin: Color = colorNewCopy(White);
    private outColorMax: Color = colorNewCopy(White);

    private output_outColor = new EntityOutput();

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.output_outColor.parse(this.entity.outcolor);
        this.registerInput('invalue', this.input_invalue.bind(this));

        const enum SpawnFlags {
            IgnoreOutOfRange   = 0x01,
        }
        const spawnflags: SpawnFlags = Number(fallbackUndefined(this.entity.spawnflags, '0'));

        this.ignoreOutOfRange = !!(spawnflags & SpawnFlags.IgnoreOutOfRange);

        const inmin = Number(fallbackUndefined(this.entity.inmin, '0'));
        const inmax = Number(fallbackUndefined(this.entity.inmax, '0'));
        this.inMin = Math.min(inmin, inmax);
        this.inMax = Math.max(inmin, inmax);

        // Avoid divide by zero
        if (this.inMin === this.inMax) {
            this.inMin = 0;
            this.inMax = 1;
        }

        vmtParseColor(this.outColorMin, this.entity.colormin);
        vmtParseColor(this.outColorMax, this.entity.colormax);
    }

    private input_invalue(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        const num = Number(value);

        const t = invlerp(this.inMin, this.inMax, num);
        if (!this.ignoreOutOfRange) {
            if (t <= 0.0)
                return;
            if (t >= 0.0)
                return;
        }

        colorLerp(scratchColor, this.outColorMin, this.outColorMax, t);
        this.output_outColor.fire(entitySystem, this, activator, strColor(scratchColor));
    }
}

export class trigger_multiple extends BaseEntity {
    public static classname = `trigger_multiple`;

    private triggerAABB: AABB | null = null;
    private isPlayerTouching = false;

    private output_onTrigger = new EntityOutput();
    private output_onStartTouch = new EntityOutput();
    private output_onStartTouchAll = new EntityOutput();
    private output_onEndTouch = new EntityOutput();
    private output_onEndTouchAll = new EntityOutput();
    private output_onTouching = new EntityOutput();
    private output_onNotTouching = new EntityOutput();

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.output_onTrigger.parse(this.entity.ontrigger);
        this.output_onStartTouch.parse(this.entity.onstarttouch);
        this.output_onStartTouchAll.parse(this.entity.onstarttouchall);
        this.output_onEndTouch.parse(this.entity.onendtouch);
        this.output_onEndTouchAll.parse(this.entity.onendtouchall);
        this.output_onTouching.parse(this.entity.ontouching);
        this.output_onNotTouching.parse(this.entity.onnottouching);
        this.registerInput('touchtest', this.input_touchtest.bind(this));

        this.visible = false;
    }

    private getAABB(): AABB | null {
        if (this.triggerAABB !== null)
            return this.triggerAABB;
        if (this.modelBSP !== null)
            return this.modelBSP.model.bbox;
        else if (this.modelStudio !== null)
            return this.modelStudio.modelData.viewBB;
        else
            return null;
    }

    public setSize(aabb: AABB | null): void {
        this.triggerAABB = aabb !== null ? aabb.clone() : null;
    }

    private input_touchtest(entitySystem: EntitySystem, activator: BaseEntity): void {
        if (this.isPlayerTouching) {
            this.output_onTouching.fire(entitySystem, this, activator);
        } else {
            this.output_onNotTouching.fire(entitySystem, this, activator);
        }
    }

    protected activateTrigger(entitySystem: EntitySystem, activator: BaseEntity): void {
        this.output_onTrigger.fire(entitySystem, this, activator);
    }

    protected multiStartTouch(entitySystem: EntitySystem, activator: BaseEntity): void {
        this.activateTrigger(entitySystem, activator);
    }

    protected onStartTouch(entitySystem: EntitySystem, activator: BaseEntity): void {
        this.output_onStartTouch.fire(entitySystem, this, activator);
        this.output_onStartTouchAll.fire(entitySystem, this, activator);

        // TODO(jstpierre): wait
        this.multiStartTouch(entitySystem, activator);
    }

    protected onTouch(entitySystem: EntitySystem): void {
    }

    protected onEndTouch(entitySystem: EntitySystem, activator: BaseEntity): void {
        this.output_onEndTouch.fire(entitySystem, this, activator);
        this.output_onEndTouchAll.fire(entitySystem, this, activator);
    }

    public override movement(entitySystem: EntitySystem, renderContext: SourceRenderContext): void {
        super.movement(entitySystem, renderContext);

        const aabb = this.getAABB();
        if (aabb === null)
            return;

        let isPlayerTouching = false;
        if (entitySystem.triggersEnabled && this.enabled) {
            const player = entitySystem.getLocalPlayer();
            mat4.invert(scratchMat4a, this.modelMatrix);
            player.getAbsOrigin(scratchVec3a);
            transformVec3Mat4w1(scratchVec3a, scratchMat4a, scratchVec3a);
    
            const playerSize = 24;
            isPlayerTouching = aabb.containsSphere(scratchVec3a, playerSize);

            if (this.isPlayerTouching !== isPlayerTouching) {
                this.isPlayerTouching = isPlayerTouching;

                if (this.isPlayerTouching)
                    this.onStartTouch(entitySystem, player);
                else
                    this.onEndTouch(entitySystem, player);
            }

            if (this.isPlayerTouching)
                this.onTouch(entitySystem);
        }

        if (renderContext.showTriggerDebug) {
            const color = this.enabled ? (isPlayerTouching ? Green : Magenta) : Cyan;
            drawWorldSpaceAABB(getDebugOverlayCanvas2D(), renderContext.currentView.clipFromWorldMatrix, aabb, this.modelMatrix, color);

            getMatrixTranslation(scratchVec3a, this.modelMatrix);
            drawWorldSpaceText(getDebugOverlayCanvas2D(), renderContext.currentView.clipFromWorldMatrix, scratchVec3a, this.entity.targetname, 0, color, { align: 'center' });
        }
    }
}

class trigger_once extends trigger_multiple {
    public static override classname = `trigger_once`;

    protected override activateTrigger(entitySystem: EntitySystem, activator: BaseEntity): void {
        super.activateTrigger(entitySystem, activator);
        this.remove();
    }
}

class trigger_look extends trigger_once {
    public static override classname = `trigger_look`;

    private fieldOfView: number = 0;
    private lookTimeAmount: number = 0;
    private target: BaseEntity | null = null;

    private startLookTime: number = -1;

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.fieldOfView = Number(this.entity.fieldofview);
        this.lookTimeAmount = Number(this.entity.looktime);
    }

    public override spawn(entitySystem: EntitySystem): void {
        super.spawn(entitySystem);

        this.target = entitySystem.findEntityByTargetName(this.entity.target);
    }

    protected override multiStartTouch(entitySystem: EntitySystem): void {
        // Do nothing.
    }

    private reset(): void {
        this.startLookTime = -1;
    }

    protected override onTouch(entitySystem: EntitySystem): void {
        super.onTouch(entitySystem);

        if (this.target === null)
            return;

        const player = entitySystem.getLocalPlayer();

        // Compute target looking direction.
        this.target.getAbsOrigin(scratchVec3a);
        player.getAbsOrigin(scratchVec3b);
        vec3.sub(scratchVec3a, scratchVec3a, scratchVec3b);
        vec3.normalize(scratchVec3a, scratchVec3a);

        const dot = vec3.dot(player.lookDir, scratchVec3a);
        if (dot < this.fieldOfView) {
            // Not in view, reset.
            this.reset();
            return;
        }

        if (this.startLookTime < 0) {
            // Starting a new look.
            this.startLookTime = entitySystem.currentTime;
        }

        const delta = entitySystem.currentTime - this.startLookTime;
        if (delta >= this.lookTimeAmount)
            this.activateTrigger(entitySystem, player);
    }

    protected override onEndTouch(entitySystem: EntitySystem, activator: BaseEntity): void {
        super.onEndTouch(entitySystem, activator);
        this.reset();
    }
}

class env_fog_controller extends BaseEntity {
    public static classname = `env_fog_controller`;
    private fogEnabled: boolean;
    private fogStart: number;
    private fogEnd: number;
    private fogMaxDensity: number;
    private fogColor1 = colorNewCopy(White);
    private fogColor2 = colorNewCopy(White);
    private fogDirection: number[];
    private farZ: number;

    public isMaster: boolean;

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        const enum SpawnFlags {
            IsMaster = 0x01,
        }
        const spawnflags: SpawnFlags = Number(fallbackUndefined(this.entity.spawnflags, '0'));
        this.isMaster = !!(spawnflags & SpawnFlags.IsMaster);

        this.fogEnabled = !!Number(this.entity.fogenable);
        vmtParseColor(this.fogColor1, this.entity.fogcolor);
        if (this.entity.fogcolor2)
            vmtParseColor(this.fogColor2, this.entity.fogcolor2);
        this.fogDirection = this.entity.fogdir ? vmtParseVector(this.entity.fogdir) : [0, 0, 0];
        this.farZ = Number(this.entity.farz);
        this.fogStart = Number(this.entity.fogstart);
        this.fogEnd = Number(this.entity.fogend);
        this.fogMaxDensity = Number(fallbackUndefined(this.entity.fogmaxdensity, '1'));

        this.registerInput('setstartdist', this.input_setstartdist.bind(this));
        this.registerInput('setenddist', this.input_setenddist.bind(this));
        this.registerInput('setfarz', this.input_setfarz.bind(this));
        this.registerInput('setcolor', this.input_setcolor.bind(this));
    }

    private input_setstartdist(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.fogStart = Number(value);
    }

    private input_setenddist(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.fogEnd = Number(value);
    }

    private input_setfarz(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.farZ = Number(value);
    }

    private input_setcolor(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        vmtParseColor(this.fogColor1, value);
    }

    public fillFogParams(dst: FogParams): void {
        dst.start = this.fogStart;
        dst.end = this.fogEnd;
        dst.maxdensity = this.fogEnabled ? this.fogMaxDensity : 0;
        // TODO(jstpierre): Color blending
        colorCopy(dst.color, this.fogColor1);
    }
}

class env_texturetoggle extends BaseEntity {
    public static classname = `env_texturetoggle`;

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.registerInput('settextureindex', this.input_settextureindex.bind(this));
        this.registerInput('incrementtextureindex', this.input_incrementtextureindex.bind(this));
    }

    private input_settextureindex(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        const valueNum = Number(value);
        if (Number.isNaN(valueNum))
            return;

        for (let i = 0; i < entitySystem.entities.length; i++) {
            const entity = entitySystem.entities[i];
            if (!entitySystem.entityMatchesTargetName(entity, this.entity.target))
                continue;

            const materialParams = entity.materialParams;
            if (materialParams !== null)
                materialParams.textureFrameIndex = valueNum;
        }
    }

    private input_incrementtextureindex(entitySystem: EntitySystem): void {
        for (let i = 0; i < entitySystem.entities.length; i++) {
            const entity = entitySystem.entities[i];
            if (!entitySystem.entityMatchesTargetName(entity, this.entity.target))
                continue;

            const materialParams = entity.materialParams;
            if (materialParams !== null)
                materialParams.textureFrameIndex++;
        }
    }
}

function findMaterialOnEntity(entity: BaseEntity, materialName: string): BaseMaterial | null {
    if (entity.modelBSP !== null)
        return entity.modelBSP.findMaterial(materialName);
    // TODO(jstpierre): modelStudio? Is it possible?
    return null;
}

class AnimControl {
    public valueStart = -1;
    public valueEnd = -1;
    public timeStart = -1;
    public timeEnd = -1;
    public loop = false;

    public setDuration(currentTime: number, duration: number): void {
        this.timeStart = currentTime;
        this.timeEnd = currentTime + duration;
    }

    public update(currentTime: number): number | null {
        if (this.timeStart < 0)
            return null;

        let time = invlerp(this.timeStart, this.timeEnd, currentTime);

        if (time > 1.0) {
            if (this.loop) {
                time = time % 1.0;
            } else {
                time = 1.0;
                this.timeStart = -1;
            }
        }

        const value = lerp(this.valueStart, this.valueEnd, time);
        return value;
    }
}

class material_modify_control extends BaseEntity {
    public static classname = `material_modify_control`;

    private materialname: string;
    private materialvar: ParameterReference;
    private value: number | null = null;

    private lerp: AnimControl | null = null;
    private textureAnim: AnimControl | null = null;

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.materialname = fallbackUndefined(this.entity.materialname, '').toLowerCase();
        this.materialvar = new ParameterReference(this.entity.materialvar, null, false);

        this.registerInput('setmaterialvar', this.input_setmaterialvar.bind(this));
        this.registerInput('startfloatlerp', this.input_startfloatlerp.bind(this));
        this.registerInput('startanimsequence', this.input_startanimsequence.bind(this));
    }

    private input_setmaterialvar(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.value = Number(value);
    }

    private input_startfloatlerp(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        const [startValue, endValue, duration, loop] = value.split(' ');

        this.lerp = new AnimControl();
        this.lerp.valueStart = Number(startValue);
        this.lerp.valueEnd = Number(endValue);
        this.lerp.setDuration(entitySystem.currentTime, Number(duration));
        this.lerp.loop = !!Number(loop);
    }

    private input_startanimsequence(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        const [startFrame, endFrame, frameRate, loop] = value.split(' ');

        this.textureAnim = new AnimControl();
        this.textureAnim.valueStart = Number(startFrame);
        this.textureAnim.valueEnd = Number(endFrame);

        if (this.textureAnim.valueEnd < 0) {
            const materialInstance = this.getMaterialInstance();
            this.textureAnim.valueEnd = materialInstance !== null ? materialInstance.getNumFrames() : 0;
        }

        const numFrames = Math.abs(this.textureAnim.valueEnd - this.textureAnim.valueStart);
        const duration = numFrames / Math.max(Number(frameRate), 1);
        this.textureAnim.setDuration(entitySystem.currentTime, duration);

        this.textureAnim.loop = !!Number(loop);
    }

    private getMaterialInstance(): BaseMaterial | null {
        const target = this.parentEntity;
        if (target === null)
            return null;

        return findMaterialOnEntity(target, this.materialname);
    }

    private syncValue(): void {
        if (this.value === null)
            return;

        const materialInstance = this.getMaterialInstance();
        if (materialInstance === null)
            return;

        paramSetNum(materialInstance.param, this.materialvar, this.value);
        this.value = null;
    }

    public override movement(entitySystem: EntitySystem, renderContext: SourceRenderContext): void {
        super.movement(entitySystem, renderContext);

        if (this.lerp !== null) {
            const lerpValue = this.lerp.update(entitySystem.currentTime);
            if (lerpValue !== null)
                this.value = lerpValue;
            else
                this.lerp = null;
        }

        if (this.textureAnim !== null) {
            const textureAnimValue = this.textureAnim.update(entitySystem.currentTime);
            if (textureAnimValue !== null && this.materialParams !== null)
                this.materialParams.textureFrameIndex = textureAnimValue;
            else
                this.textureAnim = null;
        }

        this.syncValue();
    }
}

class info_overlay_accessor extends BaseEntity {
    public static classname = `info_overlay_accessor`;
    private overlaySurfaces: BSPSurfaceRenderer[];
    private needsMaterialInit: BSPSurfaceRenderer[] | null = null;

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        const overlayid = Number(assertExists(this.entity.overlayid));
        const overlay = assertExists(bspRenderer.bsp.overlays[overlayid]);
        // console.log(`info_overlay_accessor spawn`, overlayid, overlay.surfaceIndex);
        // Overlays are only on the world spawn right now... (maybe this will always be true?)
        this.overlaySurfaces = overlay.surfaceIndexes.map((surfaceIndex) => {
            return bspRenderer.models[0].surfacesByIdx[surfaceIndex];
        });
        this.needsMaterialInit = this.overlaySurfaces.slice();
    }

    public override movement(entitySystem: EntitySystem, renderContext: SourceRenderContext): void {
        super.movement(entitySystem, renderContext);

        if (this.needsMaterialInit !== null) {
            let done = 0;
            for (let i = 0; i < this.needsMaterialInit.length; i++) {
                const surface = this.needsMaterialInit[i];
                if (surface !== null) {
                    if (surface.materialInstance === null)
                        continue;
                    surface.materialInstance.entityParams = this.ensureMaterialParams();
                }
                done++;
            }
            if (done === this.needsMaterialInit.length)
                this.needsMaterialInit = null;
        }
    }
}

class color_correction extends BaseEntity {
    public static classname = `color_correction`;

    private minfalloff: number;
    private maxfalloff: number;
    private maxweight: number;
    private filename: string;
    private layer: Uint8Array | null = null;
    private weightOverride = -1;

    public isMaster = false;
    public clientSide = false;

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.filename = fallbackUndefined(this.entity.filename, '').toLowerCase();
        this.maxweight = Number(fallbackUndefined(this.entity.maxweight, '1'));
        this.minfalloff = Number(fallbackUndefined(this.entity.minfalloff, '-1'));
        this.maxfalloff = Number(fallbackUndefined(this.entity.maxfalloff, '-1'));

        const enum SpawnFlags {
            Master = 0x01,
            ClientSide = 0x02,
        };
        const spawnflags: SpawnFlags = Number(fallbackUndefined(this.entity.spawnflags, '0'));
        this.isMaster = !!(spawnflags & SpawnFlags.Master);
        this.clientSide = !!(spawnflags & SpawnFlags.ClientSide);

        this.fetchLUT(renderContext);
    }

    private async fetchLUT(renderContext: SourceRenderContext) {
        const lutData = await renderContext.filesystem.fetchFileData(this.filename);
        if (lutData === null)
            return;

        this.layer = lutData.createTypedArray(Uint8Array);
        renderContext.colorCorrection.addLayer(this.layer);
    }

    private calcWeight(renderContext: SourceRenderContext): number {
        if (this.weightOverride >= 0.0)
            return this.weightOverride;

        if (!this.enabled)
            return 0.0;

        let weight = 1.0;

        // TODO(jstpierre): FadeIn/FadeOut

        if (this.minfalloff >= 0 && this.maxfalloff >= 0 && this.minfalloff !== this.maxfalloff) {
            this.getAbsOrigin(scratchVec3a);
            const dist = vec3.distance(renderContext.currentView.cameraPos, scratchVec3a);
            weight *= saturate(invlerp(this.minfalloff, this.maxfalloff, dist));
        }

        return weight;
    }

    private updateWeight(renderContext: SourceRenderContext): void {
        if (this.layer === null)
            return;

        const weight = this.calcWeight(renderContext);
        renderContext.colorCorrection.setLayerWeight(this.layer, weight);
    }

    public override movement(entitySystem: EntitySystem, renderContext: SourceRenderContext): void {
        super.movement(entitySystem, renderContext);
        this.updateWeight(renderContext);
    }
}

abstract class BaseLight extends BaseEntity {
    private style: number;
    private defaultstyle: number;
    private pattern: string | null = null;
    private isOn: boolean = false;

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.style = Number(fallbackUndefined(this.entity.style, '-1'));
        this.defaultstyle = Number(fallbackUndefined(this.entity.defaultstyle, '-1'));
        this.pattern = nullify(this.entity.pattern);

        if (this.entity.pitch !== undefined) {
            const pitch = Number(this.entity.pitch);
            this.localAngles[0] = pitch;
        }

        const enum SpawnFlags {
            StartOff = 0x01,
        };
        const spawnflags: SpawnFlags = Number(fallbackUndefined(this.entity.spawnflags, '0'));

        if (this.style >= 32) {
            if (this.pattern === null && this.defaultstyle >= 0)
                this.pattern = renderContext.worldLightingState.stylePatterns[this.defaultstyle];

            this.isOn = !(spawnflags & SpawnFlags.StartOff);
        } else {
            this.isOn = true;
        }

        this.registerInput('turnon', this.input_turnon.bind(this));
        this.registerInput('turnoff', this.input_turnoff.bind(this));
        this.registerInput('toggle', this.input_toggle.bind(this));
        this.registerInput('setpattern', this.input_setpattern.bind(this));
    }

    private setPattern(renderContext: SourceRenderContext, pattern: string): void {
        renderContext.worldLightingState.stylePatterns[this.style] = pattern;
    }

    private input_turnon(): void {
        this.isOn = true;
    }

    private input_turnoff(): void {
        this.isOn = false;
    }

    private input_toggle(): void {
        this.isOn = !this.isOn;
    }

    private input_setpattern(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.pattern = value;
        this.isOn = true;
    }

    public override movement(entitySystem: EntitySystem, renderContext: SourceRenderContext): void {
        super.movement(entitySystem, renderContext);

        if (this.style >= 32) {
            if (this.isOn) {
                const pattern = this.pattern !== null ? this.pattern : 'm';
                this.setPattern(renderContext, pattern);
            } else {
                this.setPattern(renderContext, 'a');
            }
        }
    }
}

class light extends BaseLight { public static classname = 'light'; }
class light_spot extends BaseLight { public static classname = 'light_spot'; }
class light_glspot extends BaseLight { public static classname = 'light_glspot'; }
class light_environment extends BaseLight { public static classname = 'light_environment'; }

class point_template extends BaseEntity {
    public static classname = 'point_template';

    private preserveNames = false;
    public templateEntity: BaseEntity[] = [];
    public templateMapData: BSPEntity[] = [];

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.registerInput('forcespawn', this.input_forcespawn.bind(this));
    }

    public createInstance(entitySystem: EntitySystem, modelMatrix: ReadonlyMat4): void {
        const mapDatas = this.templateMapData.map((mapData) => ({ ... mapData }));
        const targetMapDatas: BSPEntity[] = [];

        // Pick new target names.
        for (let i = 0; i < mapDatas.length; i++) {
            const mapData = mapDatas[i];
            if (mapData.targetname === undefined)
                continue;

            const index = entitySystem.nextDynamicTemplateSpawnIndex++;
            mapData.targetname = `${mapData.targetname}&${leftPad('' + index, 4)}`;
            targetMapDatas.push(mapData);
        }

        for (let i = 0; i < mapDatas.length; i++) {
            const mapData = mapDatas[i];

            for (let j = 0; j < targetMapDatas.length; j++) {
                if (mapData === targetMapDatas[j])
                    continue;

                const newTargetName = targetMapDatas[j].targetname;
                assert(newTargetName.includes('&'));
                const oldTargetName = newTargetName.slice(0, -5);

                for (const k in mapData) {
                    if (k === 'targetname')
                        continue;

                    let v: string[] | string = mapData[k];
                    if (Array.isArray(v)) {
                        v = v.map((s) => {
                            if (s.includes(','))
                                s = s.replace(oldTargetName, newTargetName);
                            else if (s === oldTargetName)
                                s = newTargetName;
                            return s;
                        });
                    } else {
                        if (v.includes(','))
                            v = v.replace(oldTargetName, newTargetName);
                        else if (v === oldTargetName)
                            v = newTargetName;
                    }

                    mapData[k] = v as string;
                }
            }
        }

        // Have our new map datas. Spawn them, and then move them relative to our matrix.

        const worldFromThis = modelMatrix;
        const worldFromTemplate = this.updateModelMatrix();

        for (let i = 0; i < mapDatas.length; i++) {
            const entity = entitySystem.createEntity(mapDatas[i]);

            // Position entity in world.
            const worldFromEntity = entity.updateModelMatrix();
            mat4.invert(scratchMat4a, worldFromTemplate); // templateFromWorld
            mat4.mul(scratchMat4a, scratchMat4a, worldFromEntity); // templateFromEntity
            mat4.mul(scratchMat4a, worldFromThis, scratchMat4a); // worldFromEntity
            computePosQAngleModelMatrix(scratchVec3a, scratchVec3b, scratchMat4a);
            entity.setAbsOriginAndAngles(scratchVec3a, scratchVec3b);
        }
    }

    public override spawn(entitySystem: EntitySystem): void {
        super.spawn(entitySystem);

        const enum SpawnFlags {
            DontRemoveTemplateEntities = 0x01,
            PreserveNames              = 0x02,
        };
        const spawnflags: SpawnFlags = Number(fallbackUndefined(this.entity.spawnflags, '0'));
        const removeTemplateEntities = !(spawnflags & SpawnFlags.DontRemoveTemplateEntities);
        this.preserveNames = !!(spawnflags & SpawnFlags.PreserveNames);

        for (let i = 1; i <= 16; i++) {
            const templateKeyName = `template${leftPad('' + i, 2)}`;
            const templateEntityName = this.entity[templateKeyName];
            if (templateEntityName === undefined)
                continue;

            const entity = entitySystem.findEntityByTargetName(templateEntityName);
            if (entity === null)
                continue;

            if (removeTemplateEntities)
                entity.remove();
            else
                this.templateEntity.push(entity);

            this.templateMapData.push(entity.getMapData());
        }
    }

    private input_forcespawn(entitySystem: EntitySystem): void {
        this.createInstance(entitySystem, this.updateModelMatrix());
    }
}

class env_entity_maker extends BaseEntity {
    public static classname = 'env_entity_maker';

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.registerInput('forcespawn', this.input_forcespawn.bind(this));
    }

    private spawnEntities(entitySystem: EntitySystem): void {
        const template = entitySystem.findEntityByTargetName(this.entity.entitytemplate) as point_template;
        if (template === null)
            return;

        template.createInstance(entitySystem, this.updateModelMatrix());
    }

    private input_forcespawn(entitySystem: EntitySystem): void {
        this.spawnEntities(entitySystem);
    }
}

namespace SimpleParticle {
    export class BaseParticle {
        public position = vec3.create();
        public velocity = vec3.create();
        public color = colorNewCopy(White);
        public life = 0;
        public lifetime = 0;
        public roll = 0;
        public rollDelta = 0;
        public size = 1;

        public calcLifeT(): number {
            return this.life / this.lifetime;
        }

        public calc(): void {
        }
    }

    export class OverTimeParticle extends BaseParticle {
        public startSize = 1;
        public endSize = 1;
        public startAlpha = 1;
        public endAlpha = 1;

        public override calc(): void {
            const lifeT = this.calcLifeT();
            this.size = lerp(this.startSize, this.endSize, lifeT);
            this.color.a = lerp(this.startAlpha, this.endAlpha, lifeT);
        }
    }

    export class AttractorParticle extends BaseParticle {
        public startSize = 1;
        public startAlpha = 1;

        public override calc(): void {
            const lifeT = this.calcLifeT();
            const wave = Math.sin(Math.PI * lifeT);
            this.size = this.startSize * wave;
            this.color.a = this.startAlpha * wave;
        }
    }

    export function attractorParticleUpdateVelocity(attractorOrigin: ReadonlyVec3, particle: BaseParticle, deltaTime: number): void {
        const velF = vec3.length(particle.velocity);
        vec3.normalize(particle.velocity, particle.velocity);
    
        vec3.sub(scratchVec3a, attractorOrigin, particle.position);
        vec3.normalize(scratchVec3a, scratchVec3a);
    
        const speed = clamp(velF * 1.2, 0, 1024);
        vec3.scaleAndAdd(particle.velocity, particle.velocity, scratchVec3a, speed);
    }

    export function simulateParticles(pool: BaseParticle[], deltaTime: number): void {
        for (let i = 0; i < pool.length; i++) {
            const p = pool[i];

            p.life += deltaTime;
            if (p.life >= p.lifetime) {
                pool.splice(i--, 1);
                continue;
            }

            p.calc();

            p.roll += p.rollDelta * deltaTime;
            vec3.scaleAndAdd(p.position, p.position, p.velocity, deltaTime);
        }
    }

    export function renderParticles(pool: BaseParticle[], materialInstance: BaseMaterial, renderInstManager: GfxRenderInstManager, renderContext: SourceRenderContext): void {
        const view = renderContext.currentView;
        const staticQuad = renderContext.materialCache.staticResources.staticQuad;
        for (let i = 0; i < pool.length; i++) {
            const p = pool[i];

            const renderInst = renderInstManager.newRenderInst();
            staticQuad.setQuadOnRenderInst(renderInst);

            // This is a bit hacky -- set the color/alpha per-particle. Blergh.
            materialInstance.paramSetColor('$color', p.color);
            materialInstance.paramSetNumber('$alpha', p.color.a);

            materialInstance.setOnRenderInst(renderContext, renderInst);

            computeModelMatrixR(scratchMat4a, p.roll * MathConstants.DEG_TO_RAD, 0, 0);

            getMatrixAxisZ(scratchVec3a, view.worldFromViewMatrix);
            computeMatrixForForwardDir(scratchMat4b, scratchVec3a, Vec3Zero);

            mat4.mul(scratchMat4a, scratchMat4b, scratchMat4a);
            scaleMatrix(scratchMat4a, scratchMat4a, p.size);
            setMatrixTranslation(scratchMat4a, p.position);

            materialInstance.setOnRenderInstModelMatrix(renderInst, scratchMat4a);

            const depth = computeViewSpaceDepthFromWorldSpacePoint(view.viewFromWorldMatrix, p.position);
            renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);

            materialInstance.getRenderInstListForView(view).submitRenderInst(renderInst);
        }
    }
}

async function createSimpleMaterial(renderContext: SourceRenderContext, materialName: string, entityParams: EntityMaterialParameters): Promise<BaseMaterial> {
    const materialInstance = await renderContext.materialCache.createMaterialInstance(materialName);
    materialInstance.entityParams = entityParams;
    await materialInstance.init(renderContext);
    return materialInstance;
}

class env_steam extends BaseEntity {
    public static classname = 'env_steam';

    private startSize = 0;
    private endSize = 0;
    private rollSpeed = 0;
    private spreadSpeed = 0;
    private speed = 0;
    private invRate = 0;
    private particleLifetime = 0;
    private lightingRamp: Color[] = nArray(5, () => colorNewCopy(White));

    // Emit state.
    private shouldEmit = false;
    private emitTimer = 0;

    private particlePool: SimpleParticle.BaseParticle[] = [];

    private materialInstance: BaseMaterial | null = null;

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.startSize = Number(fallbackUndefined(this.entity.startsize, '0'));
        this.endSize = Number(fallbackUndefined(this.entity.endsize, '0'));
        this.spreadSpeed = Number(fallbackUndefined(this.entity.spreadspeed, '0'));
        this.speed = Number(fallbackUndefined(this.entity.speed, '0'));
        const rate = Number(fallbackUndefined(this.entity.rate, '0'));
        this.invRate = 1.0 / rate;
        this.rollSpeed = Number(fallbackUndefined(this.entity.rollspeed, '0'));

        const jetLength = Number(fallbackUndefined(this.entity.jetlength, '0'));
        this.particleLifetime = jetLength / this.speed;

        const initialstate = Number(fallbackUndefined(this.entity.initialstate, '0'));
        if (initialstate !== 0)
            this.shouldEmit = true;

        const enum Type {
            HEATWAVE = 0x01,
        };
        const type: Type = Number(fallbackUndefined(this.entity.type, '0'));

        if (type === Type.HEATWAVE) {
            this.bindMaterial(renderContext, `sprites/heatwave`);
        } else {
            this.bindMaterial(renderContext, `particle/particle_smokegrenade`);
        }

        this.registerInput('turnon', this.input_turnon.bind(this));
        this.registerInput('turnoff', this.input_turnoff.bind(this));
        this.registerInput('toggle', this.input_toggle.bind(this));
    }

    private calcLightingRamp(entitySystem: EntitySystem): void {
        const modelMatrix = this.updateModelMatrix();
        // Forward axis.
        getMatrixAxisX(scratchVec3b, modelMatrix);

        for (let i = 0; i < this.lightingRamp.length; i++) {
            const t = i / (this.lightingRamp.length - 1);

            getMatrixTranslation(scratchVec3a, modelMatrix);
            vec3.scaleAndAdd(scratchVec3a, scratchVec3a, scratchVec3b, t);

            worldLightingCalcColorForPoint(this.lightingRamp[i], entitySystem.bspRenderer, scratchVec3a);
        }
    }

    public override spawn(entitySystem: EntitySystem): void {
        super.spawn(entitySystem);

        this.calcLightingRamp(entitySystem);
    }

    private emit(renderContext: SourceRenderContext): void {
        if (!this.shouldEmit)
            return;

        this.emitTimer += renderContext.globalDeltaTime;

        let numParticlesToEmit = 0;
        while (this.emitTimer >= this.invRate) {
            numParticlesToEmit++;
            this.emitTimer -= this.invRate;
        }

        if (numParticlesToEmit <= 0)
            return;

        const modelMatrix = this.updateModelMatrix();

        for (let i = 0; i < numParticlesToEmit; i++) {
            const p = new SimpleParticle.BaseParticle();
            getMatrixTranslation(p.position, modelMatrix);

            // Forward axis
            getMatrixAxisX(scratchVec3a, modelMatrix);
            vec3.scaleAndAdd(p.velocity, p.velocity, scratchVec3a, this.speed);

            // Spread axes
            getMatrixAxisY(scratchVec3a, modelMatrix);
            vec3.scaleAndAdd(p.velocity, p.velocity, scratchVec3a, randomRange(this.spreadSpeed));
            getMatrixAxisZ(scratchVec3a, modelMatrix);
            vec3.scaleAndAdd(p.velocity, p.velocity, scratchVec3a, randomRange(this.spreadSpeed));

            p.roll = randomRange(0, 360);
            p.rollDelta = randomRange(-this.rollSpeed, this.rollSpeed);
            p.lifetime = this.particleLifetime;

            this.particlePool.push(p);
        }
    }

    public override movement(entitySystem: EntitySystem, renderContext: SourceRenderContext): void {
        super.movement(entitySystem, renderContext);

        this.emit(renderContext);
        SimpleParticle.simulateParticles(this.particlePool, renderContext.globalDeltaTime);
    }

    private async bindMaterial(renderContext: SourceRenderContext, materialName: string) {
        this.materialInstance = await createSimpleMaterial(renderContext, materialName, this.ensureMaterialParams());
    }

    private calcLightingColor(dst: Color, lifeT: number): void {
        const tt = (lifeT * (this.lightingRamp.length - 1));
        const i0 = Math.floor(tt), i1 = Math.ceil(tt), t = tt - i0;
        colorLerp(dst, this.lightingRamp[i0], this.lightingRamp[i1], t);
    }

    public override prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager): void {
        if (!this.shouldDraw())
            return;

        if (this.materialInstance === null)
            return;

        for (let i = 0; i < this.particlePool.length; i++) {
            const p = this.particlePool[i];
            const lifeT = (p.life / p.lifetime);

            this.calcLightingColor(p.color, lifeT);
            p.color.a = this.renderamt * Math.sin(lifeT * (MathConstants.TAU / 2));
            p.size = lerp(this.startSize, this.endSize, lifeT);
        }

        SimpleParticle.renderParticles(this.particlePool, this.materialInstance, renderInstManager, renderContext);
    }

    private input_turnon(entitySystem: EntitySystem): void {
        this.shouldEmit = true;
    }

    private input_turnoff(entitySystem: EntitySystem): void {
        this.shouldEmit = false;
    }

    private input_toggle(entitySystem: EntitySystem): void {
        this.shouldEmit = !this.shouldEmit;
    }
}

const enum env_citadel_energy_core_state { Idle, Charging, Discharging }
class env_citadel_energy_core extends BaseEntity {
    public static classname = `env_citadel_energy_core`;

    private state = env_citadel_energy_core_state.Idle;
    private stateStartTime = 0.0;
    private stateDuration = 0.0;
    private scale = 1.0;
    private chargeParticlesEnabled = false;

    private coreParticles: SimpleParticle.OverTimeParticle[] = [];
    private chargingParticles: SimpleParticle.AttractorParticle[] = [];
    private dischargingCoreParticles: SimpleParticle.OverTimeParticle[] = [];
    private dischargingParticles: SimpleParticle.AttractorParticle[] = [];

    private chargingMaterial: BaseMaterial | null = null;
    private dischargingCoreMaterial: BaseMaterial | null = null;
    private dischargingMaterial: BaseMaterial | null = null;

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.scale = Number(fallbackUndefined(this.entity.scale, '1'));

        this.registerInput('startcharge', this.input_startcharge.bind(this));
        this.registerInput('startdischarge', this.input_startdischarge.bind(this));
        this.registerInput('stop', this.input_stop.bind(this));

        this.bindMaterials(renderContext);

        const enum SpawnFlags {
            NO_PARTICLES = 0x01,
            START_ON     = 0x02,
        };
        const spawnflags: SpawnFlags = Number(fallbackUndefined(this.entity.spawnflags, '0'));
        this.chargeParticlesEnabled = !(spawnflags & SpawnFlags.NO_PARTICLES);

        if (spawnflags & SpawnFlags.START_ON)
            this.startDischarge(entitySystem);
    }

    private async bindMaterials(renderContext: SourceRenderContext) {
        this.chargingMaterial = await createSimpleMaterial(renderContext, 'effects/strider_muzzle', this.ensureMaterialParams());
        this.dischargingCoreMaterial = await createSimpleMaterial(renderContext, 'effects/combinemuzzle2', this.ensureMaterialParams());
        this.dischargingMaterial = await createSimpleMaterial(renderContext, 'effects/combinemuzzle2_dark', this.ensureMaterialParams());
    }

    public override movement(entitySystem: EntitySystem, renderContext: SourceRenderContext): void {
        super.movement(entitySystem, renderContext);

        const t = this.stateDuration !== 0 ? saturate(invlerp(this.stateStartTime, this.stateStartTime + this.stateDuration, renderContext.globalTime)) : 0.0;
        if (this.state === env_citadel_energy_core_state.Idle) {
            this.updateIdle(entitySystem, renderContext, 1.0 - t);
        } else if (this.state === env_citadel_energy_core_state.Charging) {
            this.updateCharging(entitySystem, renderContext, t);
        } else if (this.state === env_citadel_energy_core_state.Discharging) {
            this.updateDischarging(entitySystem, renderContext);
        }

        SimpleParticle.simulateParticles(this.chargingParticles, renderContext.globalDeltaTime);
        SimpleParticle.simulateParticles(this.dischargingCoreParticles, renderContext.globalDeltaTime);
        SimpleParticle.simulateParticles(this.dischargingParticles, renderContext.globalDeltaTime);

        this.getAbsOrigin(scratchVec3b);
        for (let i = 0; i < this.chargingParticles.length; i++)
            SimpleParticle.attractorParticleUpdateVelocity(scratchVec3b, this.chargingParticles[i], renderContext.globalDeltaTime);
        for (let i = 0; i < this.dischargingParticles.length; i++)
            SimpleParticle.attractorParticleUpdateVelocity(scratchVec3b, this.dischargingParticles[i], renderContext.globalDeltaTime);
    }

    public override prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager): void {
        if (!this.shouldDraw())
            return;

        if (this.chargingMaterial !== null)
            SimpleParticle.renderParticles(this.chargingParticles, this.chargingMaterial, renderInstManager, renderContext);
        if (this.dischargingMaterial !== null)
            SimpleParticle.renderParticles(this.dischargingParticles, this.dischargingMaterial, renderInstManager, renderContext);
        if (this.dischargingCoreMaterial !== null)
            SimpleParticle.renderParticles(this.dischargingCoreParticles, this.dischargingCoreMaterial, renderInstManager, renderContext);
    }

    private updateIdle(entitySystem: EntitySystem, renderContext: SourceRenderContext, t: number): void {
        if (renderContext.globalDeltaTime === 0.0)
            return;

        if (t >= 1.0)
            return;

        if (this.chargeParticlesEnabled) {
            const numParticlesToEmit = (t * 4.0 * renderContext.globalDeltaTime) | 0;
            if (numParticlesToEmit <= 0)
                return;

            const modelMatrix = this.updateModelMatrix();
            for (let i = 0; i < numParticlesToEmit; i++) {
                const p = new SimpleParticle.AttractorParticle();
                const randT = Math.random();
                const dist = lerp(4.0 * t, 64.0 * t, randT);
                this.getAbsOrigin(p.position);
                getMatrixAxisX(scratchVec3a, modelMatrix);
                vec3.scaleAndAdd(p.position, p.position, scratchVec3a, dist);
                const spreadRange = lerp(6.0, 1.0, randT) * 4.0;
                getMatrixAxisY(scratchVec3a, modelMatrix);
                vec3.scaleAndAdd(p.position, p.position, scratchVec3a, randomRange(spreadRange));
                getMatrixAxisZ(scratchVec3a, modelMatrix);
                vec3.scaleAndAdd(p.position, p.position, scratchVec3a, randomRange(spreadRange));
                p.velocity[2] = 8.0;
                p.startAlpha = t;
                p.startSize = randomRange(1, 2);
                p.lifetime = 0.2;
                p.roll = randomRange(0, 360);
                this.chargingParticles.push(p);
            }
        }
    }

    private updateCharging(entitySystem: EntitySystem, renderContext: SourceRenderContext, t: number): void {
        if (renderContext.globalDeltaTime === 0.0)
            return;

        if (t <= 0.0)
            return;

        // Core
        const coreScale = 4.0 * this.scale * t;
        for (let i = 0; i < 2; i++) {
            const p = new SimpleParticle.OverTimeParticle();
            this.getAbsOrigin(p.position);
            p.startAlpha = t;
            p.endAlpha = 0;
            p.startSize = coreScale * (i + 1);
            p.endSize = p.startSize * 2.0;
            p.lifetime = 0.1;
            p.roll = randomRange(0, 360);
            this.coreParticles.push(p);
        }

        if (this.chargeParticlesEnabled) {
            const numParticlesToEmit = (t * 4.0 * renderContext.globalDeltaTime) | 0;
            if (numParticlesToEmit <= 0)
                return;

            const modelMatrix = this.updateModelMatrix();
            for (let i = 0; i < numParticlesToEmit; i++) {
                const p = new SimpleParticle.AttractorParticle();
                const randT = Math.random();
                const dist = lerp(4.0 * t, 64.0 * t, randT);
                this.getAbsOrigin(p.position);
                getMatrixAxisX(scratchVec3a, modelMatrix);
                vec3.scaleAndAdd(p.position, p.position, scratchVec3a, dist);
                const spreadRange = lerp(6.0, 1.0, randT) * 4.0;
                getMatrixAxisY(scratchVec3a, modelMatrix);
                vec3.scaleAndAdd(p.position, p.position, scratchVec3a, randomRange(spreadRange));
                getMatrixAxisZ(scratchVec3a, modelMatrix);
                vec3.scaleAndAdd(p.position, p.position, scratchVec3a, randomRange(spreadRange));
                p.velocity[2] = 8.0;
                p.startAlpha = t;
                p.startSize = randomRange(1, 2);
                p.lifetime = 0.2;
                p.roll = randomRange(0, 360);
                this.chargingParticles.push(p);
            }
        }
    }

    private updateDischarging(entitySystem: EntitySystem, renderContext: SourceRenderContext): void {
        if (renderContext.globalDeltaTime === 0.0)
            return;

        // Core effects
        const coreScale = 8.0 * this.scale;

        const modelMatrix = this.updateModelMatrix();

        // Core
        for (let i = 0; i < 3; i++) {
            const p = new SimpleParticle.OverTimeParticle();
            this.getAbsOrigin(p.position);
            getMatrixAxisX(p.velocity, modelMatrix);
            vec3.scale(p.velocity, p.velocity, 32.0 * i);

            if (i === 2 && getRandomInt(0, 20) === 0) {
                p.lifetime = 0.25;
            } else {
                p.lifetime = 0.2;
            }

            p.roll = randomRange(0, 360);
            p.startAlpha = 0.5;
            p.endAlpha = 0;

            if (i === 0 || i === 2) {
                p.startSize = coreScale * 2.0;
            } else {
                p.startSize = coreScale;
            }

            p.endSize = p.startSize * 2.0;

            if (i === 0)
                this.chargingParticles.push(p);
            else
                this.dischargingCoreParticles.push(p);
        }

        if (this.chargeParticlesEnabled) {
            const modelMatrix = this.updateModelMatrix();
            for (let i = 0; i < 4; i++) {
                const p = new SimpleParticle.AttractorParticle();
                const randT = Math.random();
                const dist = lerp(4.0, 64.0, randT) * this.scale;
                this.getAbsOrigin(p.position);
                getMatrixAxisX(scratchVec3a, modelMatrix);
                vec3.scaleAndAdd(p.position, p.position, scratchVec3a, dist);
                const spreadRange = lerp(6.0, 1.0, randT) * 2.0 * this.scale;
                getMatrixAxisY(scratchVec3a, modelMatrix);
                vec3.scaleAndAdd(p.position, p.position, scratchVec3a, randomRange(spreadRange));
                getMatrixAxisZ(scratchVec3a, modelMatrix);
                vec3.scaleAndAdd(p.position, p.position, scratchVec3a, randomRange(spreadRange));
                p.lifetime = 0.5;
                p.roll = randomRange(0, 360);
                p.velocity[2] = 2.0;
                p.startAlpha = 1;
                p.startSize = 1;
                this.dischargingParticles.push(p);
            }
        }
    }

    public startCharge(entitySystem: EntitySystem, duration: number): void {
        this.state = env_citadel_energy_core_state.Charging;
        this.stateStartTime = entitySystem.currentTime;
        this.stateDuration = duration;
    }

    public startDischarge(entitySystem: EntitySystem): void {
        this.state = env_citadel_energy_core_state.Discharging;
        this.stateStartTime = entitySystem.currentTime;
    }

    public stopDischarge(entitySystem: EntitySystem, duration: number): void {
        this.state = env_citadel_energy_core_state.Idle;
        this.stateStartTime = entitySystem.currentTime;
        this.stateDuration = duration;
    }

    private input_startcharge(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.startCharge(entitySystem, Number(value));
    }

    private input_startdischarge(entitySystem: EntitySystem): void {
        this.startDischarge(entitySystem);
    }

    private input_stop(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.stopDischarge(entitySystem, Number(value));
    }
}

class env_sprite extends BaseEntity {
    public static classname = `env_sprite`;

    public scale: number;
    public framerate: number;
    public frame: number;
    public maxframe: number;
    public once: boolean = false;

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.scale = Number(this.entity.scale);
        this.framerate = Number(this.entity.framerate);
        this.frame = Number(fallbackUndefined(this.entity.frame, '0'));

        this.registerInput('showsprite', this.input_showsprite.bind(this));
        this.registerInput('hidesprite', this.input_hidesprite.bind(this));
        this.registerInput('togglesprite', this.input_togglesprite.bind(this));
        this.registerInput('setscale', this.input_setscale.bind(this));
        this.registerInput('color', this.input_color.bind(this));
        this.registerInput('colorredvalue', this.input_colorredvalue.bind(this));
        this.registerInput('colorgreenvalue', this.input_colorgreenvalue.bind(this));
        this.registerInput('colorbluevalue', this.input_colorbluevalue.bind(this));
    }

    public override spawn(entitySystem: EntitySystem): void {
        super.spawn(entitySystem);

        const sprite = assertExists(this.modelSprite);
        this.maxframe = sprite.materialInstance.getNumFrames();

        const enum SpawnFlags {
            StartOn = 0x01,
            Once    = 0x02,
        };
        const spawnflags: SpawnFlags = Number(fallbackUndefined(this.entity.spawnflags, '0'));
        this.visible = this.targetName === null || !!(spawnflags & SpawnFlags.StartOn);
        this.once = !!(spawnflags & SpawnFlags.Once);
    }

    public override movement(entitySystem: EntitySystem, renderContext: SourceRenderContext): void {
        super.movement(entitySystem, renderContext);

        this.frame += this.framerate * renderContext.globalDeltaTime;
        if (this.framerate >= 0 && this.maxframe > 1 && this.frame >= this.maxframe) {
            this.frame = 0;
            if (this.once)
                this.visible = false;
        }

        const sprite = assertExists(this.modelSprite);
        this.getAbsOriginAndAngles(sprite.origin, sprite.angles);
        sprite.scale = this.scale;

        sprite.materialInstance.paramSetNumber('$frame', this.frame);

        sprite.materialInstance.movement(renderContext);
    }

    private input_showsprite(entitySystem: EntitySystem): void {
        this.visible = true;
        this.frame = 0;
    }

    private input_hidesprite(entitySystem: EntitySystem): void {
        this.visible = false;
    }

    private input_togglesprite(entitySystem: EntitySystem): void {
        this.visible = !this.visible;
    }

    private input_setscale(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.scale = Number(value);
    }

    private input_color(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        vmtParseColor(this.rendercolor, value);
    }

    private input_colorredvalue(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.rendercolor.r = Number(value) / 255.0;
    }

    private input_colorgreenvalue(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.rendercolor.g = Number(value) / 255.0;
    }

    private input_colorbluevalue(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.rendercolor.b = Number(value) / 255.0;
    }
}

// Alias
class env_glow extends env_sprite {
    public static override classname = `env_glow`;
}

class env_sprite_clientside extends env_sprite {
    public static override classname = `env_sprite_clientside`;
}

class env_tonemap_controller extends BaseEntity {
    public static classname = `env_tonemap_controller`;

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.registerInput('setbloomscale', this.input_setbloomscale.bind(this));
        this.registerInput('setautoexposuremin', this.input_setautoexposuremin.bind(this));
        this.registerInput('setautoexposuremax', this.input_setautoexposuremax.bind(this));
        this.registerInput('settonemaprate', this.input_settonemaprate.bind(this));
        this.registerInput('settonemappercenttarget', this.input_settonemappercenttarget.bind(this));
        this.registerInput('settonemappercentbrightpixels', this.input_settonemappercentbrightpixels.bind(this));
        this.registerInput('settonemapminavglum', this.input_settonemapminavglum.bind(this));
    }

    private input_setbloomscale(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        const v = Number(value);
        if (v > 0.0)
            entitySystem.renderContext.toneMapParams.bloomScale = v;
    }

    private input_setautoexposuremin(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        const v = Number(value);
        if (v > 0.0)
            entitySystem.renderContext.toneMapParams.autoExposureMin = v;
    }

    private input_setautoexposuremax(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        const v = Number(value);
        if (v > 0.0)
            entitySystem.renderContext.toneMapParams.autoExposureMax = v;
    }

    private input_settonemaprate(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        entitySystem.renderContext.toneMapParams.adjustRate = Number(value);
    }

    private input_settonemappercenttarget(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        entitySystem.renderContext.toneMapParams.percentTarget = Number(value) / 100.0;
    }

    private input_settonemappercentbrightpixels(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        entitySystem.renderContext.toneMapParams.percentBrightPixels = Number(value) / 100.0;
    }

    private input_settonemapminavglum(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        entitySystem.renderContext.toneMapParams.minAvgLum = Number(value) / 100.0;
    }
}

function calcViewFromWorldMatrixForEntity(dst: mat4, entity: BaseEntity): void {
    entity.getAbsOriginAndAngles(scratchVec3a, scratchVec3b);

    mat4.identity(dst);
    mat4.rotateX(dst, dst, -MathConstants.TAU / 4);
    mat4.rotateZ(dst, dst, MathConstants.TAU / 4);

    mat4.rotateX(dst, dst, -scratchVec3b[2] * MathConstants.DEG_TO_RAD);
    mat4.rotateY(dst, dst, -scratchVec3b[0] * MathConstants.DEG_TO_RAD);
    mat4.rotateZ(dst, dst, -scratchVec3b[1] * MathConstants.DEG_TO_RAD);

    vec3.negate(scratchVec3a, scratchVec3a);
    mat4.translate(dst, dst, scratchVec3a);
}

export function calcFrustumViewProjection(dst: SourceEngineView, renderContext: SourceRenderContext, fovY: number, aspect: number, nearZ: number, farZ: number): void {
    const nearY = Math.tan(MathConstants.DEG_TO_RAD * 0.5 * fovY) * nearZ;
    const nearX = nearY * aspect;
    projectionMatrixForFrustum(dst.clipFromViewMatrix, -nearX, nearX, -nearY, nearY, nearZ, farZ);
    projectionMatrixReverseDepth(dst.clipFromViewMatrix);
    const clipSpaceNearZ = renderContext.device.queryVendorInfo().clipSpaceNearZ;
    projectionMatrixConvertClipSpaceNearZ(dst.clipFromViewMatrix, clipSpaceNearZ, GfxClipSpaceNearZ.NegativeOne);
    dst.clipSpaceNearZ = clipSpaceNearZ;
    dst.finishSetup();
}

export class env_projectedtexture extends BaseEntity {
    public static classname = `env_projectedtexture`;

    private fovY: number;
    private nearZ: number;
    private style: number = -1;
    private brightnessScale: number = 8;

    public projectedLightRenderer = new ProjectedLightRenderer();

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.fovY = Number(entity.lightfov);
        this.nearZ = Number(entity.nearz);
        this.projectedLightRenderer.light.farZ = Number(entity.farz);
        vmtParseColor(this.projectedLightRenderer.light.lightColor, entity.lightcolor);
        this.brightnessScale = Number(entity.brightnessscale);
        this.style = vmtParseNumber(entity.style, -1);

        const enum SpawnFlags {
            ENABLED = 0x01,
        };
        const spawnflags: SpawnFlags = Number(entity.spawnflags);
        this.enabled = !!(spawnflags & SpawnFlags.ENABLED);

        this.fetchTexture(renderContext, entity.texturename);

        this.registerInput('turnon', this.input_turnon.bind(this));
        this.registerInput('turnoff', this.input_turnoff.bind(this));
        this.registerInput('setfov', this.input_setfov.bind(this));
        this.registerInput('setlightcolor', this.input_setlightcolor.bind(this));
        this.registerInput('setlightstyle', this.input_setlightstyle.bind(this));
        this.registerInput('setpattern', this.input_setpattern.bind(this));
    }

    private updateFrustumView(renderContext: SourceRenderContext): void {
        calcViewFromWorldMatrixForEntity(this.projectedLightRenderer.light.frustumView.viewFromWorldMatrix, this);
        const aspect = 1.0;
        calcFrustumViewProjection(this.projectedLightRenderer.light.frustumView, renderContext, this.fovY, aspect, this.nearZ, this.projectedLightRenderer.light.farZ);
    }

    private async fetchTexture(renderContext: SourceRenderContext, textureName: string) {
        const materialCache = renderContext.materialCache;
        this.projectedLightRenderer.light.texture = await materialCache.fetchVTF(textureName, true);
    }

    private input_turnon(): void {
        this.enabled = true;
    }

    private input_turnoff(): void {
        this.enabled = false;
    }

    private input_setfov(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.fovY = Number(value);
    }

    private input_setlightcolor(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        vmtParseColor(this.projectedLightRenderer.light.lightColor, value);
    }

    private input_setlightstyle(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        this.style = Number(value);
    }

    private input_setpattern(entitySystem: EntitySystem, activator: BaseEntity, value: string): void {
        entitySystem.renderContext.worldLightingState.stylePatterns[this.style] = value;
    }

    public override movement(entitySystem: EntitySystem, renderContext: SourceRenderContext): void {
        super.movement(entitySystem, renderContext);
        this.projectedLightRenderer.reset();

        if (!this.shouldDraw())
            return;

        const styleIntensity = this.style >= 0 ? renderContext.worldLightingState.styleIntensities[this.style] : 1.0;
        this.projectedLightRenderer.light.brightnessScale = this.brightnessScale * styleIntensity;
    
        this.updateFrustumView(renderContext);
    }
}

export class env_shake extends BaseEntity {
    public static classname = `env_shake`;

    public amplitude: number;
    public interval: number;
    public duration: number;
    public squaredRadius: number;

    public shakeOffset = vec3.create();
    public shakeRoll = 0;
    public shakeStartTime = -1;

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.amplitude = Number(this.entity.amplitude);
        this.interval = 1.0 / Number(this.entity.frequency);
        this.duration = Number(this.entity.duration);
        this.squaredRadius = Number(this.entity.radius) ** 2.0;

        // TODO(jstpierre): Portal testchmb_a_04 seems to set this to an absurdly low 2.5?
        // Double check this with the original game.
        this.interval = 1.0 / 40;

        this.registerInput('startshake', this.input_startshake.bind(this));
        this.registerInput('stopshake', this.input_stopshake.bind(this));
    }

    private input_startshake(entitySystem: EntitySystem): void {
        entitySystem.getLocalPlayer().getAbsOrigin(scratchVec3a);
        this.getAbsOrigin(scratchVec3b);
        if (vec3.squaredDistance(scratchVec3a, scratchVec3b) > this.squaredRadius)
            return;

        this.shakeStartTime = entitySystem.currentTime;
    }

    private input_stopshake(entitySystem: EntitySystem): void {
        this.shakeStartTime = -1;
    }

    public override movement(entitySystem: EntitySystem, renderContext: SourceRenderContext): void {
        super.movement(entitySystem, renderContext);

        if (this.shakeStartTime < 0)
            return;

        const time = (entitySystem.currentTime - this.shakeStartTime);
        if (time >= this.duration) {
            // Done.
            this.shakeStartTime = -1;
            vec3.zero(this.shakeOffset);
            this.shakeRoll = 0;
            renderContext.currentShake = null;
            return;
        }

        renderContext.currentShake = this;

        if (renderContext.crossedRepeatTime(this.shakeStartTime, this.interval)) {
            // Compute new shake vector.
            const amplitude = this.amplitude * ((1.0 - (time / this.duration)) ** 2);
            getRandomVector(this.shakeOffset, amplitude);
            this.shakeRoll = MathConstants.DEG_TO_RAD * randomRange(amplitude) * 0.25;
        }
    }

    public adjustView(view: SourceEngineView): void {
        mat4.fromTranslation(scratchMat4a, this.shakeOffset);
        mat4.rotateZ(scratchMat4a, scratchMat4a, this.shakeRoll);
        mat4.mul(view.viewFromWorldMatrix, scratchMat4a, view.viewFromWorldMatrix);
    }
}

class fog_volume extends BaseEntity {
    public static classname = `fog_volume`;

    public fogController: env_fog_controller | null = null;
    public postProcessController: BaseEntity | null = null;
    public colorCorrection: color_correction | null = null;

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.visible = false;
    }

    public override spawn(entitySystem: EntitySystem): void {
        super.spawn(entitySystem);

        if (this.entity.fogname)
            this.fogController = entitySystem.findEntityByTargetName(this.entity.fogname) as env_fog_controller | null;
        if (this.entity.postprocessname)
            this.postProcessController = entitySystem.findEntityByTargetName(this.entity.postprocessname) as BaseEntity | null;
        if (this.entity.colorcorrectionname)
            this.colorCorrection = entitySystem.findEntityByTargetName(this.entity.colorcorrectionname) as color_correction | null;
    }

    public contains(p: ReadonlyVec3): boolean {
        if (!this.enabled)
            return false;

        if (this.modelBSP === null)
            return false;

        mat4.invert(scratchMat4a, this.modelMatrix);
        transformVec3Mat4w1(scratchVec3a, scratchMat4a, p);
        return this.modelBSP.model.bbox.containsPoint(p);
    }
}

export class point_camera extends BaseEntity {
    public static classname = `point_camera`;

    private fovY: number;
    private nearZ: number = 0.1;
    private farZ: number = 10000.0;
    private useScreenAspectRatio: boolean;

    public viewRenderer = new SourceWorldViewRenderer(`Camera`, SourceEngineViewType.MainView);

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.fovY = Number(this.entity.fov);
        this.useScreenAspectRatio = fallbackUndefined(this.entity.usescreenaspectratio, '1') !== '0';

        this.viewRenderer.pvsFallback = false;
        this.viewRenderer.renderObjectMask &= ~(RenderObjectKind.DetailProps);
    }

    private updateFrustumView(renderContext: SourceRenderContext): void {
        const frustumView = this.viewRenderer.mainView;
        calcViewFromWorldMatrixForEntity(frustumView.viewFromWorldMatrix, this);
        const aspect = this.useScreenAspectRatio ? renderContext.currentView.aspect : 1.0;
        calcFrustumViewProjection(frustumView, renderContext, this.fovY, aspect, this.nearZ, this.farZ);
    }

    public override movement(entitySystem: EntitySystem, renderContext: SourceRenderContext): void {
        super.movement(entitySystem, renderContext);
        this.viewRenderer.reset();

        if (!this.shouldDraw())
            return;

        this.updateFrustumView(renderContext);
    }

    public preparePasses(renderer: SourceRenderer): void {
        this.viewRenderer.prepareToRender(renderer, null);
    }

    public pushPasses(renderer: SourceRenderer, builder: GfxrGraphBuilder, mainColorDesc: GfxrRenderTargetDescription): void {
        const cameraColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT_SRGB);
        cameraColorDesc.copyDimensions(mainColorDesc);
        cameraColorDesc.width /= 2;
        cameraColorDesc.height /= 2;

        this.viewRenderer.pushPasses(renderer, builder, cameraColorDesc);
    }
}

class BaseMonitor extends BaseEntity {
    public target: string;

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.target = fallbackUndefined(this.entity.target, '');
    }

    public override movement(entitySystem: EntitySystem, renderContext: SourceRenderContext): void {
        super.movement(entitySystem, renderContext);

        if (!this.shouldDraw() || !this.checkFrustum(renderContext))
            return;

        const camera = entitySystem.findEntityByTargetName(this.target);
        if (camera === null || !(camera instanceof point_camera))
            return;

        renderContext.currentPointCamera = camera;
    }
}

class func_monitor extends BaseMonitor {
    public static classname = `func_monitor`;
}

class info_camera_link extends BaseMonitor {
    public static classname = `info_camera_link`;
}

export class info_player_start extends BaseEntity {
    public static classname = `info_player_start`;
}

class ParticleSystemController {
    public controlPoints: ParticleControlPoint[] = [];
    private controlPointEntity: BaseEntity[] = [];
    public instances: ParticleSystemInstance[] = [];

    constructor(public entity: BaseEntity) {
        this.addControlPoint(0, this.entity);
    }

    public addControlPoint(i: number, entity: BaseEntity): void {
        this.controlPointEntity[i] = entity;
        this.controlPoints[i] = new ParticleControlPoint();
    }

    public stop(): void {
        for (let i = 0; i < this.instances.length; i++)
            this.instances[i].emitActive = false;
    }

    public stopImmediate(renderContext: SourceRenderContext): void {
        for (let i = 0; i < this.instances.length; i++)
            this.instances[i].destroy(renderContext.device);

        this.instances.length = 0;
    }

    public movement(renderContext: SourceRenderContext): void {
        for (let i = 0; i < this.instances.length; i++) {
            const instance = this.instances[i];

            for (let i = 0; i < this.controlPointEntity.length; i++) {
                const entity = this.controlPointEntity[i];
                if (entity === undefined)
                    continue;

                const point = this.controlPoints[i];
                mat4.copy(point.prevTransform, point.transform);
                mat4.copy(point.transform, entity.updateModelMatrix());
            }

            instance.movement(renderContext);

            if (instance.isFinished()) {
                instance.destroy(renderContext.device);
                this.instances.splice(i--, 1);
            }
        }
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager): void {
        for (let i = 0; i < this.instances.length; i++)
            this.instances[i].prepareToRender(renderContext, renderInstManager);
    }
}

class info_particle_system extends BaseEntity {
    public static classname = `info_particle_system`;
    private controller: ParticleSystemController;
    private active = false;

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);
        this.controller = new ParticleSystemController(this);

        this.registerInput('start', this.input_start.bind(this));
        this.registerInput('stop', this.input_stop.bind(this));
        this.registerInput('destroyimmediately', this.input_destroyimmediately.bind(this));

        if (entity.start_active)
            this.active = !!Number(entity.start_active);
    }

    public override spawn(entitySystem: EntitySystem): void {
        super.spawn(entitySystem);

        for (let i = 1; i < 64; i++) {
            const controlPointEntityName = this.entity[`cpoint${i}`];
            if (controlPointEntityName === undefined)
                continue;
            const controlPointEntity = entitySystem.findEntityByTargetName(controlPointEntityName);
            if (controlPointEntity === null)
                continue;
            this.controller.addControlPoint(i, controlPointEntity);
        }

        if (this.active)
            this.start(entitySystem);
    }

    private start(entitySystem: EntitySystem): void {
        const systemName = this.entity.effect_name;
        const def = entitySystem.renderContext.materialCache.particleSystemCache.getParticleSystemDefinition(systemName);
        if (def === null)
            return;

        const systemInstance = new ParticleSystemInstance(entitySystem.renderContext, def, this.controller);
        this.controller.instances.push(systemInstance);
    }

    private input_start(entitySystem: EntitySystem): void {
        if (this.active)
            return;

        this.active = true;
        this.start(entitySystem);
    }

    private input_stop(entitySystem: EntitySystem): void {
        if (!this.active)
            return;

        this.active = false;
        this.controller.stop();
    }

    private input_destroyimmediately(entitySystem: EntitySystem): void {
        if (!this.active)
            return;

        this.active = true;
        this.controller.stopImmediate(entitySystem.renderContext);
    }

    public override movement(entitySystem: EntitySystem, renderContext: SourceRenderContext): void {
        super.movement(entitySystem, renderContext);
        if (this.controller === null)
            return;
        this.controller.movement(renderContext);
    }
    
    public override prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager): void {
        if (!this.shouldDraw())
            return;

        if (this.controller === null)
            return;

        this.controller.prepareToRender(renderContext, renderInstManager);
    }
}

interface EntityFactory<T extends BaseEntity = BaseEntity> {
    new(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity): T;
    classname: string;
}

interface QueuedOutputEvent {
    sender: BaseEntity;
    activator: BaseEntity;
    triggerTime: number;
    action: EntityOutputAction;
    value: EntityMessageValue;
}

export class EntityFactoryRegistry {
    public classname = new Map<string, EntityFactory>();

    constructor() {
        this.registerDefaultFactories();
    }

    private registerDefaultFactories(): void {
        this.registerFactory(worldspawn);
        this.registerFactory(sky_camera);
        this.registerFactory(water_lod_control);
        this.registerFactory(func_movelinear);
        this.registerFactory(func_door);
        this.registerFactory(func_door_rotating);
        this.registerFactory(func_rotating);
        this.registerFactory(func_tracktrain);
        this.registerFactory(func_areaportalwindow);
        this.registerFactory(func_instance_io_proxy);
        this.registerFactory(logic_auto);
        this.registerFactory(logic_relay);
        this.registerFactory(logic_branch);
        this.registerFactory(logic_case);
        this.registerFactory(logic_timer);
        this.registerFactory(logic_compare);
        this.registerFactory(math_counter);
        this.registerFactory(math_remap);
        this.registerFactory(math_colorblend);
        this.registerFactory(trigger_multiple);
        this.registerFactory(trigger_once);
        this.registerFactory(trigger_look);
        this.registerFactory(env_fog_controller);
        this.registerFactory(env_texturetoggle);
        this.registerFactory(material_modify_control);
        this.registerFactory(info_overlay_accessor);
        this.registerFactory(color_correction);
        this.registerFactory(light);
        this.registerFactory(light_spot);
        this.registerFactory(light_glspot);
        this.registerFactory(light_environment);
        this.registerFactory(point_template);
        this.registerFactory(env_entity_maker);
        this.registerFactory(env_steam);
        this.registerFactory(env_citadel_energy_core);
        this.registerFactory(env_sprite);
        this.registerFactory(env_glow);
        this.registerFactory(env_sprite_clientside);
        this.registerFactory(env_tonemap_controller);
        this.registerFactory(env_projectedtexture);
        this.registerFactory(env_shake);
        this.registerFactory(fog_volume);
        this.registerFactory(point_camera);
        this.registerFactory(func_monitor);
        this.registerFactory(info_camera_link);
        this.registerFactory(info_player_start);
        // this.registerFactory(info_particle_system);
        this.registerFactory(path_track);
    }

    public registerFactory(factory: EntityFactory): void {
        this.classname.set(factory.classname, factory);
    }

    public createEntity(entitySystem: EntitySystem, renderContext: SourceRenderContext, renderer: BSPRenderer, bspEntity: BSPEntity): BaseEntity {
        const factory = this.classname.get(bspEntity.classname);

        if (factory !== undefined) {
            return new factory(entitySystem, renderContext, renderer, bspEntity);
        } else {
            // Fallback
            return new BaseEntity(entitySystem, renderContext, renderer, bspEntity);
        }
    }
}

export class EntitySystem {
    public entities: BaseEntity[] = [];
    public entityCreateQueue: BaseEntity[] = [];
    public currentTime = 0;
    public nextDynamicTemplateSpawnIndex = 0;
    public debugger = new EntityMessageDebugger();
    public triggersEnabled = true;
    private outputQueue: QueuedOutputEvent[] = [];

    constructor(public renderContext: SourceRenderContext, public bspRenderer: BSPRenderer) {
        // Create our hardcoded entities first.
        this.entities.push(new player(this, this.renderContext, this.bspRenderer));
    }

    public entityMatchesTargetName(entity: BaseEntity, targetName: string): boolean {
        if (!entity.targetName)
            return false;

        if (entity.targetName === targetName)
            return true;

        if (targetName.endsWith('*')) {
            if (entity.targetName.startsWith(targetName.slice(0, -1)))
                return true;
        } else if (targetName.includes('*')) {
            debugger;
        }

        return false;
    }

    public queueOutputEvent(action: EntityOutputAction, sender: BaseEntity, activator: BaseEntity, value: EntityMessageValue): void {
        if (action.parameterOverride !== '')
            value = action.parameterOverride;

        const triggerTime = this.currentTime + action.delay;
        this.outputQueue.push({ sender, activator, action, triggerTime, value });
    }

    public cancelOutputEventsForSender(sender: BaseEntity): void {
        for (let i = 0; i < this.outputQueue.length; i++)
            if (this.outputQueue[i].sender === sender)
                this.outputQueue.splice(i--, 1);
    }

    // For console debugging.
    private queueOutput(targetName: string, field: string, value: EntityMessageValue): void {
        const ent = this.findEntityByTargetName(targetName);
        if (ent === null)
            return;

        const output = new EntityOutput();
        output.parse((ent as any).entity[field]);
        output.fire(this, this.getLocalPlayer(), this.getLocalPlayer(), value);
    }

    // For console debugging.
    private queueOutputAction(S: string, value: EntityMessageValue): void {
        const action = parseEntityOutputAction(S);
        this.queueOutputEvent(action, this.getLocalPlayer(), this.getLocalPlayer(), value);
    }

    public findEntityByType<T extends BaseEntity>(type: EntityFactory<T>, start: T | null = null): T | null {
        let i = start !== null ? this.entities.indexOf(start) + 1 : 0;
        for (; i < this.entities.length; i++)
            if (this.entities[i] instanceof type)
                return this.entities[i] as T;
        return null;
    }

    public findEntityByTargetName(targetName: string): BaseEntity | null {
        targetName = targetName.toLowerCase();
        for (let i = 0; i < this.entities.length; i++)
            if (this.entities[i].targetName === targetName)
                return this.entities[i];
        return null;
    }

    private fireInput(target: BaseEntity, event: QueuedOutputEvent): void {
        this.debugger.fireInput(target, event, this.currentTime);
        target.fireInput(this, event.action.inputName, event.activator, event.value);
    }

    private fireEntityOutputAction(event: QueuedOutputEvent): boolean {
        if (this.currentTime < event.triggerTime)
            return false;

        if (event.action.targetName === '!activator') {
            this.fireInput(event.activator, event);
        } else if (event.action.targetName === '!self') {
            this.fireInput(event.sender, event);
        } else {
            for (let i = 0; i < this.entities.length; i++) {
                const target = this.entities[i];
                if (!this.entityMatchesTargetName(target, event.action.targetName))
                    continue;
                this.fireInput(target, event);
            }
        }

        return true;
    }

    private processOutputQueue(): void {
        for (let i = 0; i < this.outputQueue.length; i++)
            if (this.fireEntityOutputAction(this.outputQueue[i]))
                this.outputQueue.splice(i--, 1);
    }

    private getSpawnStateAction(): SpawnState {
        if (!this.renderContext.materialCache.isInitialized())
            return SpawnState.FetchingResources;

        let spawnState = SpawnState.Spawned;
        for (let i = 0; i < this.entities.length; i++) {
            if (this.entities[i].spawnState === SpawnState.FetchingResources)
                return SpawnState.FetchingResources;
            else if (this.entities[i].spawnState === SpawnState.ReadyForSpawn)
                spawnState = SpawnState.ReadyForSpawn;
        }
        return spawnState;
    }

    private flushCreateQueue(): void {
        if (this.entityCreateQueue.length > 0) {
            this.entities.push(... this.entityCreateQueue);
            this.entityCreateQueue.length = 0;
        }
    }

    public movement(renderContext: SourceRenderContext): void {
        this.currentTime = renderContext.globalTime;

        this.flushCreateQueue();

        const spawnStateAction = this.getSpawnStateAction();
        if (spawnStateAction === SpawnState.FetchingResources) {
            // Still fetching; nothing to do.
            return;
        } else if (spawnStateAction === SpawnState.ReadyForSpawn) {
            for (let i = 0; i < this.entities.length; i++)
                if (this.entities[i].spawnState === SpawnState.ReadyForSpawn)
                    this.entities[i].spawn(this);
        }

        this.processOutputQueue();
        this.debugger.movement(renderContext);

        for (let i = 0; i < this.entities.length; i++) {
            if (!this.entities[i].alive) {
                this.entities.splice(i--, 1);
                continue;
            }

            this.entities[i].movement(this, renderContext);
        }
    }

    public createEntity(bspEntity: BSPEntity): BaseEntity {
        const registry = this.renderContext.entityFactoryRegistry;
        const entity = registry.createEntity(this, this.renderContext, this.bspRenderer, bspEntity);
        this.entityCreateQueue.push(entity);
        return entity;
    }

    public createAndSpawnEntities(bspEntities: BSPEntity[]): void {
        for (let i = 0; i < bspEntities.length; i++)
            this.createEntity(bspEntities[i]);

        this.flushCreateQueue();
    }

    public getLocalPlayer(): player {
        return this.findEntityByTargetName('!player')! as player;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.entities.length; i++)
            this.entities[i].destroy(device);
    }
}

interface EntityMessageDebuggerItem {
    target: BaseEntity;
    event: QueuedOutputEvent;
    time: number;
}

class EntityMessageDebugger {
    private messages: EntityMessageDebuggerItem[] = [];
    public capture = IS_DEVELOPMENT;
    public draw = IS_DEVELOPMENT;

    public fireInput(target: BaseEntity, event: QueuedOutputEvent, time: number): void {
        if (!this.capture)
            return;

        this.messages.unshift({ target, event, time });
    }

    // Show for 1 second, then fade it out for 1 second.

    public timeFull = 1;
    public timeFade = 1;
    public movement(renderContext: SourceRenderContext): void {
        if (!this.draw)
            return;

        const activatorColor = colorNewCopy(Green);
        const targetColor = colorNewCopy(Red);
        const lineColor = colorNewCopy(White);

        const timeTotal = this.timeFade + this.timeFull;
        for (let i = 0; i < this.messages.length; i++) {
            const message = this.messages[i];
            const timeDelta = renderContext.globalTime - message.time;

            if (timeDelta > timeTotal) {
                this.messages.length = i;
                break;
            }

            const alpha = saturate(invlerp(timeTotal, this.timeFull, timeDelta));
            activatorColor.a = alpha;
            targetColor.a = alpha;
            lineColor.a = alpha;

            const sender = message.event.sender, target = message.target;
            const ctx = getDebugOverlayCanvas2D();

            sender.getAbsOrigin(scratchVec3a);
            target.getAbsOrigin(scratchVec3b);

            const fontSize = 8 * window.devicePixelRatio;
            drawWorldSpacePoint(ctx, renderContext.currentView.clipFromWorldMatrix, scratchVec3a, activatorColor, 6);
            drawWorldSpacePoint(ctx, renderContext.currentView.clipFromWorldMatrix, scratchVec3b, targetColor, 6);
            drawWorldSpaceLine(ctx, renderContext.currentView.clipFromWorldMatrix, scratchVec3a, scratchVec3b, lineColor, 3);
            drawWorldSpaceText(ctx, renderContext.currentView.clipFromWorldMatrix, scratchVec3b, target.targetName!, 6, lineColor, { outline: 3, font: `${fontSize}pt monospace` });
            drawWorldSpaceText(ctx, renderContext.currentView.clipFromWorldMatrix, scratchVec3b, message.event.action.inputName, 18, lineColor, { outline: 3, font: `${fontSize}pt monospace` });
        }
    }
}
