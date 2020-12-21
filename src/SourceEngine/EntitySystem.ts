
import { mat4, ReadonlyVec3, vec3 } from 'gl-matrix';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderer';
import { computeModelMatrixSRT, getMatrixTranslation, MathConstants, transformVec3Mat4w1 } from '../MathHelpers';
import { assert, assertExists, fallbackUndefined } from '../util';
import { computeAmbientCubeFromLeaf, newAmbientCube } from './BSPFile';
import { BSPModelRenderer, SourceRenderContext, BSPRenderer, SourceEngineView } from './Main';
import { EntityMaterialParameters, LightCache } from './Materials';
import { computeModelMatrixPosQAngle, StudioModelData, StudioModelInstance } from "./Studio";
import { BSPEntity, vmtParseNumbers } from './VMT';

interface EntityOutputAction {
    targetName: string;
    inputName: string;
    parameterOverride: string;
    delay: number;
    timesToFire: number;
}

function parseEntityOutputAction(S: string): EntityOutputAction {
    const parts = S.split(',');
    assert(parts.length === 5);
    const [targetName, inputNameStr, parameterOverride, delayStr, timesToFireStr] = parts;
    const inputName = inputNameStr.toLowerCase();
    const delay = Number(delayStr);
    const timesToFire = Number(timesToFireStr);
    return { targetName, inputName, parameterOverride, delay, timesToFire };
}

class EntityOutput {
    public actions: EntityOutputAction[] = [];

    public parse(S: string | string[] | undefined): void {
        if (Array.isArray(S))
            S.forEach((s) => this.parse(s));
        else if (S !== undefined)
            this.actions.push(parseEntityOutputAction(S));
    }

    public fire(entitySystem: EntitySystem, value: string = ''): void {
        for (let i = 0; i < this.actions.length; i++)
            entitySystem.fireEntityOutputAction(this.actions[i], value);
    }
}

type EntityInputFunc = (entitySystem: EntitySystem, value: string) => void;

const scratchMat4a = mat4.create();
export class BaseEntity {
    public modelBSP: BSPModelRenderer | null = null;
    public modelStudio: StudioModelInstance | null = null;

    public origin = vec3.create();
    public angles = vec3.create();
    public renderamt: number = 1.0;
    public visible = true;
    public materialParams: EntityMaterialParameters | null = null;

    public targetName: string | null = null;
    public parentEntity: BaseEntity | null = null;

    public outputs: EntityOutput[] = [];
    public inputs = new Map<string, EntityInputFunc>();

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, private bspRenderer: BSPRenderer, protected entity: BSPEntity) {
        if (entity.model) {
            this.materialParams = new EntityMaterialParameters();

            if (entity.model.startsWith('*')) {
                const index = parseInt(entity.model.slice(1), 10);
                this.modelBSP = bspRenderer.models[index];
                this.modelBSP.setEntity(this);
            } else if (entity.model.endsWith('.mdl')) {
                // External model reference.
                this.fetchStudioModel(renderContext);
            }
        }

        if (entity.origin) {
            const origin = vmtParseNumbers(entity.origin);
            vec3.set(this.origin, origin[0], origin[1], origin[2]);
        }

        if (entity.angles) {
            const angles = vmtParseNumbers(entity.angles);
            vec3.set(this.angles, angles[0], angles[1], angles[2]);
        }

        if (entity.renderamt)
            this.renderamt = Number(entity.renderamt) / 255.0;

        if (entity.targetname)
            this.targetName = '' + entity.targetname;
    }

    protected registerInput(inputName: string, func: EntityInputFunc): void {
        assert(!this.inputs.has(inputName));
        this.inputs.set(inputName, func);
    }

    public fireInput(entitySystem: EntitySystem, inputName: string, value: string): void {
        const func = this.inputs.get(inputName);
        if (!func)
            return;

        func(entitySystem, value);
    }

    private updateLightingData(): void {
        const materialParams = this.materialParams!;

        const modelMatrix = this.updateModelMatrix()!;
        getMatrixTranslation(materialParams.position, modelMatrix);

        const leaf = assertExists(this.bspRenderer.bsp.findLeafForPoint(materialParams.position));
        computeAmbientCubeFromLeaf(materialParams.ambientCube!, leaf, materialParams.position);
        materialParams.lightCache = new LightCache(this.bspRenderer.bsp, materialParams.position, this.modelStudio!.modelData.bbox);
    }

    protected modelUpdated(): void {
    }

    private async fetchStudioModel(renderContext: SourceRenderContext) {
        const modelData = await renderContext.studioModelCache.fetchStudioModelData(this.entity.model!);
        this.modelStudio = new StudioModelInstance(renderContext, modelData, this.materialParams!);
        this.materialParams!.ambientCube = newAmbientCube();
        this.modelUpdated();
        this.updateLightingData();
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, view: SourceEngineView): void {
        if (!this.visible)
            return;

        if (this.modelBSP !== null) {
            // BSP models are rendered by the BSP system.
        } else if (this.modelStudio !== null) {
            this.modelStudio.prepareToRender(renderContext, renderInstManager);
        }
    }

    public setParentEntity(parentEntity: BaseEntity | null): void {
        if (parentEntity === this.parentEntity)
            return;

        if (this.parentEntity !== null) {
            const parentModelMatrix = this.parentEntity.updateModelMatrix();
            if (parentModelMatrix !== null) {
                // Transform origin into absolute world-space.
                transformVec3Mat4w1(this.origin, parentModelMatrix, this.origin);
            }
        }

        this.parentEntity = parentEntity;

        if (this.parentEntity !== null) {
            const parentModelMatrix = this.parentEntity.updateModelMatrix();
            if (parentModelMatrix !== null) {
                // Transform origin from world-space into entity space.
                mat4.invert(scratchMat4a, parentModelMatrix);
                transformVec3Mat4w1(this.origin, scratchMat4a, this.origin);
            }
        }
    }

    public spawn(entitySystem: EntitySystem): void {
        if (this.entity.parentname)
            this.setParentEntity(entitySystem.findEntityByTargetName(this.entity.parentname));
    }

    protected updateModelMatrix(): mat4 | null {
        let modelMatrix: mat4;

        if (this.modelBSP !== null) {
            modelMatrix = this.modelBSP.modelMatrix;
        } else if (this.modelStudio !== null) {
            modelMatrix = this.modelStudio.modelMatrix;
        } else {
            return null;
        }

        computeModelMatrixPosQAngle(modelMatrix, this.origin, this.angles);

        if (this.parentEntity !== null) {
            const parentModelMatrix = this.parentEntity.updateModelMatrix();
            if (parentModelMatrix !== null)
                mat4.mul(modelMatrix, parentModelMatrix, modelMatrix);
        }

        return modelMatrix;
    }

    public movement(entitySystem: EntitySystem, renderContext: SourceRenderContext): void {
        if (this.modelBSP !== null || this.modelStudio !== null) {
            const modelMatrix = this.updateModelMatrix()!;
            getMatrixTranslation(this.materialParams!.position, modelMatrix);

            let visible = this.visible;
            if (this.renderamt === 0)
                visible = false;

            if (this.modelBSP !== null)
                this.modelBSP.visible = visible;
            else if (this.modelStudio !== null)
                this.modelStudio.visible = visible;
        }
    }
}

export class sky_camera extends BaseEntity {
    public static classname = 'sky_camera';
    public area: number = -1;
    public scale: number = 1;
    public modelMatrix = mat4.create();

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);
        const leaf = assertExists(bspRenderer.bsp.findLeafForPoint(this.origin));
        this.area = leaf.area;
        this.scale = Number(entity.scale);
        computeModelMatrixSRT(this.modelMatrix, this.scale, this.scale, this.scale, 0, 0, 0,
            this.scale * -this.origin[0],
            this.scale * -this.origin[1],
            this.scale * -this.origin[2]);
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

function angleVec(dstForward: vec3, rot: ReadonlyVec3): void {
    const rx = rot[0] * MathConstants.DEG_TO_RAD, ry = rot[1] * MathConstants.DEG_TO_RAD;
    const sx = Math.sin(rx), cx = Math.cos(rx);
    const sy = Math.sin(ry), cy = Math.cos(ry);

    dstForward[0] = cx*cy;
    dstForward[1] = cx*sy;
    dstForward[2] = -sx;
}

const enum ToggleState {
    Top, Bottom, GoingToTop, GoingToBottom,
}

abstract class BaseToggle extends BaseEntity {
    public moveDir = vec3.create();
    public startPosition: number;
    public moveDistance: number;
    public speed: number;
    
    protected positionOpened = vec3.create();
    protected positionClosed = vec3.create();

    protected timeLeftInSeconds = 0.0;
    protected positionTarget = vec3.create();
    protected velocityPerSecond = vec3.create();

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        vec3.copy(this.moveDir, vmtParseNumbers(fallbackUndefined(this.entity.movedir, "")) as vec3);
        this.startPosition = fallbackUndefined(Number(this.entity.startposition), 0.0);
        this.moveDistance = fallbackUndefined(Number(this.entity.movedistance), 0.0);
        this.speed = fallbackUndefined(Number(this.entity.speed), 0.0);
    }

    protected moveToTargetPos(entitySystem: EntitySystem, positionTarget: ReadonlyVec3, speedInSeconds: number): void {
        vec3.copy(this.positionTarget, positionTarget);
        vec3.sub(this.velocityPerSecond, this.positionTarget, this.origin);
        this.timeLeftInSeconds = vec3.length(this.velocityPerSecond) / speedInSeconds;
        if (this.timeLeftInSeconds <= 0.0)
            this.moveDone(entitySystem);
        else
            vec3.scale(this.velocityPerSecond, this.velocityPerSecond, 1.0 / this.timeLeftInSeconds);
    }

    public movement(entitySystem: EntitySystem, renderContext: SourceRenderContext): void {
        super.movement(entitySystem, renderContext);

        const deltaTimeInSeconds = renderContext.globalDeltaTime;

        if (this.timeLeftInSeconds > 0.0) {
            // Apply the velocity.
            vec3.scaleAndAdd(this.origin, this.origin, this.velocityPerSecond, deltaTimeInSeconds);
            this.timeLeftInSeconds -= deltaTimeInSeconds;

            // If we've reached the target position, then we're done.
            if (this.timeLeftInSeconds <= 0.0) {
                vec3.copy(this.origin, this.positionTarget);
                vec3.zero(this.velocityPerSecond);
                this.timeLeftInSeconds = 0.0;
                this.moveDone(entitySystem);
            }
        }
    }

    protected abstract moveDone(entitySystem: EntitySystem): void;
}

const scratchVec3a = vec3.create();
class func_movelinear extends BaseToggle {
    public static classname = `func_movelinear`;

    private output_onFullyClosed = new EntityOutput();
    private output_onFullyOpen = new EntityOutput();

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.output_onFullyOpen.parse(this.entity.onfullyopen);
        this.output_onFullyClosed.parse(this.entity.onfullyclosed);
        this.registerInput('open', this.input_open.bind(this));
        this.registerInput('close', this.input_close.bind(this));

        angleVec(scratchVec3a, this.moveDir);
        vec3.scaleAndAdd(this.positionOpened, this.origin, scratchVec3a, -this.moveDistance * this.startPosition);
        vec3.scaleAndAdd(this.positionClosed, this.origin, scratchVec3a,  this.moveDistance);
    }

    protected moveDone(entitySystem: EntitySystem): void {
        if (vec3.distance(this.origin, this.positionClosed) < MathConstants.EPSILON)
            this.output_onFullyClosed.fire(entitySystem);
        if (vec3.distance(this.origin, this.positionOpened) < MathConstants.EPSILON)
            this.output_onFullyOpen.fire(entitySystem);
    }

    private input_open(entitySystem: EntitySystem): void {
        this.moveToTargetPos(entitySystem, this.positionOpened, this.speed);
    }

    private input_close(entitySystem: EntitySystem): void {
        this.moveToTargetPos(entitySystem, this.positionClosed, this.speed);
    }
}

class func_door extends BaseToggle {
    public static classname = `func_door`;

    private output_onClose = new EntityOutput();
    private output_onOpen = new EntityOutput();
    private output_onFullyClosed = new EntityOutput();
    private output_onFullyOpen = new EntityOutput();

    private modelExtents = vec3.create();
    private locked: boolean = false;
    protected toggleState: ToggleState;

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        // TODO(jstpierre): Rotating doors

        this.output_onClose.parse(this.entity.onclose);
        this.output_onOpen.parse(this.entity.onopen);
        this.output_onFullyClosed.parse(this.entity.onfullyclosed);
        this.output_onFullyOpen.parse(this.entity.onfullyopen);

        this.registerInput('close', this.input_close.bind(this));
        this.registerInput('open', this.input_open.bind(this));
        this.registerInput('toggle', this.input_toggle.bind(this));

        const spawnpos = Number(fallbackUndefined(this.entity.spawnpos, '0'));
        if (spawnpos === 1)
            this.toggleState = ToggleState.Top;
        else
            this.toggleState = ToggleState.Bottom;

        vec3.copy(this.positionOpened, this.origin);
        vec3.copy(this.positionClosed, this.origin);

        this.updateExtents();
    }

    private updateExtents(): void {
        if (this.modelBSP !== null)
            this.modelBSP.model.bbox.extents(this.modelExtents);
        else if (this.modelStudio !== null)
            this.modelStudio.modelData.bbox.extents(this.modelExtents);

        angleVec(scratchVec3a, this.moveDir);
        const moveDistance = Math.abs(vec3.dot(scratchVec3a, this.modelExtents));
        vec3.scaleAndAdd(this.positionOpened, this.positionClosed, scratchVec3a, moveDistance);
    }

    protected modelUpdated(): void {
        this.updateExtents();
    }

    private goToTop(entitySystem: EntitySystem): void {
        this.toggleState = ToggleState.GoingToTop;
        this.moveToTargetPos(entitySystem, this.positionOpened, this.speed);
        this.output_onOpen.fire(entitySystem);
    }

    private goToBottom(entitySystem: EntitySystem): void {
        this.toggleState = ToggleState.GoingToBottom;
        this.moveToTargetPos(entitySystem, this.positionClosed, this.speed);
        this.output_onClose.fire(entitySystem);
    }

    private hitTop(entitySystem: EntitySystem): void {
        this.output_onFullyOpen.fire(entitySystem);
    }

    private hitBottom(entitySystem: EntitySystem): void {
        this.output_onFullyClosed.fire(entitySystem);
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
}

class logic_auto extends BaseEntity {
    public static classname = `logic_auto`;

    private output_onMapSpawn = new EntityOutput();

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.output_onMapSpawn.parse(this.entity.onmapspawn);
    }

    public spawn(entitySystem: EntitySystem): void {
        this.output_onMapSpawn.fire(entitySystem);
    }
}

class logic_relay extends BaseEntity {
    public static classname = `logic_relay`;

    private output_onTrigger = new EntityOutput();

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.output_onTrigger.parse(this.entity.ontrigger);
        this.registerInput('trigger', this.input_trigger.bind(this));
    }

    private input_trigger(entitySystem: EntitySystem): void {
        this.output_onTrigger.fire(entitySystem);
    }
}

class env_texturetoggle extends BaseEntity {
    public static classname = `env_texturetoggle`;

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.registerInput('settextureindex', this.input_settextureindex.bind(this));
    }

    private input_settextureindex(entitySystem: EntitySystem, value: string): void {
        const valueNum = Number(value);
        if (Number.isNaN(valueNum))
            return;

        const target = entitySystem.findEntityByTargetName(this.entity.target);
        if (target === null)
            return;

        if (target.materialParams !== null)
            target.materialParams.textureFrameIndex = valueNum;
    }
}

interface EntityFactory {
    new(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity): BaseEntity;
    classname: string;
}

export class EntitySystem {
    public classname = new Map<string, EntityFactory>();
    public entities: BaseEntity[] = [];

    constructor() {
        this.registerDefaultFactories();
    }

    private registerDefaultFactories(): void {
        this.registerFactory(sky_camera);
        this.registerFactory(water_lod_control);
        this.registerFactory(func_movelinear);
        this.registerFactory(func_door);
        this.registerFactory(logic_auto);
        this.registerFactory(logic_relay);
        this.registerFactory(env_texturetoggle);
    }

    public registerFactory(factory: EntityFactory): void {
        this.classname.set(factory.classname, factory);
    }

    public fireEntityOutputAction(action: EntityOutputAction, value: string): void {
        // TODO(jstpierre): Support multicast / wildcard target names
        const target = this.findEntityByTargetName(action.targetName);
        if (target === null)
            return;

        if (action.parameterOverride !== '')
            value = action.parameterOverride;

        target.fireInput(this, action.inputName, value);
    }

    public findEntityByTargetName(targetName: string): BaseEntity | null {
        for (let i = 0; i < this.entities.length; i++)
            if (this.entities[i].targetName === targetName)
                return this.entities[i];
        return null;
    }

    public movement(renderContext: SourceRenderContext): void {
        for (let i = 0; i < this.entities.length; i++)
            this.entities[i].movement(this, renderContext);
    }

    private spawn(): void {
        for (let i = 0; i < this.entities.length; i++)
            this.entities[i].spawn(this);
    }

    private createEntity(renderContext: SourceRenderContext, renderer: BSPRenderer, entity: BSPEntity): void {
        const factory = this.classname.has(entity.classname) ? this.classname.get(entity.classname)! : BaseEntity;
        const entityInstance = new factory(this, renderContext, renderer, entity);
        this.entities.push(entityInstance);
    }

    public createEntities(renderContext: SourceRenderContext, renderer: BSPRenderer, entities: BSPEntity[]): void {
        for (let i = 0; i < entities.length; i++)
            this.createEntity(renderContext, renderer, entities[i]);
        this.spawn();
    }
}
