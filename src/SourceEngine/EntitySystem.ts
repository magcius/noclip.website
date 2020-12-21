
import { mat4, ReadonlyVec3, vec3 } from 'gl-matrix';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderer';
import { computeModelMatrixSRT, MathConstants } from '../MathHelpers';
import { assertExists } from '../util';
import { computeAmbientCubeFromLeaf, newAmbientCube } from './BSPFile';
import { BSPModelRenderer, SourceRenderContext, BSPRenderer, SourceEngineView } from './Main';
import { EntityMaterialParameters, LightCache } from './Materials';
import { computeModelMatrixPosRotStudio, StudioModelInstance } from "./Studio";
import { BSPEntity, vmtParseNumbers } from './VMT';

function computeModelMatrixPosRot(dst: mat4, pos: ReadonlyVec3, rot: ReadonlyVec3): void {
    const rotX = MathConstants.DEG_TO_RAD * rot[0];
    const rotY = MathConstants.DEG_TO_RAD * rot[1];
    const rotZ = MathConstants.DEG_TO_RAD * rot[2];
    const transX = pos[0];
    const transY = pos[1];
    const transZ = pos[2];
    computeModelMatrixSRT(dst, 1, 1, 1, rotX, rotY, rotZ, transX, transY, transZ);
}

export class BaseEntity {
    public modelBSP: BSPModelRenderer | null = null;
    public modelStudio: StudioModelInstance | null = null;

    public origin = vec3.create();
    public angles = vec3.create();
    public renderamt: number = 1.0;
    public visible = true;
    public materialParams: EntityMaterialParameters | null = null;

    constructor(renderContext: SourceRenderContext, bspRenderer: BSPRenderer, private entity: BSPEntity) {
        if (entity.model) {
            this.materialParams = new EntityMaterialParameters();

            if (entity.model.startsWith('*')) {
                const index = parseInt(entity.model.slice(1), 10);
                this.modelBSP = bspRenderer.models[index];
                this.modelBSP.setEntity(this);
            } else if (entity.model.endsWith('.mdl')) {
                // External model reference.
                this.fetchStudioModel(renderContext, bspRenderer);
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
    }

    private async fetchStudioModel(renderContext: SourceRenderContext, bspRenderer: BSPRenderer) {
        const modelData = await renderContext.studioModelCache.fetchStudioModelData(this.entity.model!);
        this.modelStudio = new StudioModelInstance(renderContext, modelData, this.materialParams!);

        const leaf = assertExists(bspRenderer.bsp.findLeafForPoint(this.origin));
        this.materialParams!.ambientCube = newAmbientCube();
        computeAmbientCubeFromLeaf(this.materialParams!.ambientCube, leaf, this.origin);

        this.materialParams!.lightCache = new LightCache(bspRenderer.bsp, this.origin, modelData.bbox);
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

    public movement(): void {
        if (this.modelBSP !== null || this.modelStudio !== null) {
            vec3.copy(this.materialParams!.position, this.origin);

            if (this.modelBSP !== null) {
                computeModelMatrixPosRot(this.modelBSP.modelMatrix, this.origin, this.angles);
            } else if (this.modelStudio !== null) {
                computeModelMatrixPosRotStudio(this.modelStudio.modelMatrix, this.origin, this.angles);
            }

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

    constructor(renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(renderContext, bspRenderer, entity);
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

    constructor(renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(renderContext, bspRenderer, entity);
        if (entity.cheapwaterstartdistance !== undefined)
            renderContext.cheapWaterStartDistance = Number(entity.cheapwaterstartdistance);
        if (entity.cheapwaterenddistance !== undefined)
            renderContext.cheapWaterEndDistance = Number(entity.cheapwaterenddistance);
    }
}

class func_movelinear extends BaseEntity {
    public static classname = `func_movelinear`;

    constructor(renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(renderContext, bspRenderer, entity);
    }

    public movement(): void {
        super.movement();
    }
}

interface EntityFactory {
    new(renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity): BaseEntity;
    classname: string;
}

export class EntitySystem {
    public classname = new Map<string, EntityFactory>();

    constructor() {
        this.registerDefaultFactories();
    }

    private registerDefaultFactories(): void {
        this.registerFactory(sky_camera);
        this.registerFactory(water_lod_control);
    }

    public registerFactory(factory: EntityFactory): void {
        this.classname.set(factory.classname, factory);
    }

    public createEntity(renderContext: SourceRenderContext, renderer: BSPRenderer, entity: BSPEntity): BaseEntity {
        const factory = this.classname.has(entity.classname) ? this.classname.get(entity.classname)! : BaseEntity;
        return new factory(renderContext, renderer, entity);
    }
}
