
import { DrawBufferHolder, drawBufferInitialTable, LightType, DrawCameraType } from "./DrawBuffer";
import { SceneObjHolder } from "./Main";
import { ViewerRenderInput } from "../viewer";
import { GfxTexture, GfxDevice } from "../gfx/platform/GfxPlatform";
import { Camera } from "../Camera";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { LiveActor } from "./LiveActor";
import { NormalizedViewportCoords } from "../gfx/helpers/RenderTargetHelpers";
import { JMapInfoIter } from "./JMapInfo";
import { mat4 } from "gl-matrix";
import { assert } from "../util";
import { ub_SceneParams, ub_SceneParamsBufferSize } from "../gx/gx_render";

export const enum MovementType {
    ScreenEffect                   = 0x03,
    AreaObj                        = 0x0D,
    Model3DFor2D                   = 0x0E,
    Planet                         = 0x1D,
    CollisionMapObj                = 0x1E,
    CollisionEnemy                 = 0x1F,
    Environment                    = 0x21,
    MapObj                         = 0x22,
    MapObjDecoration               = 0x23,
    Sky                            = 0x24,
    NPC                            = 0x28,
    Enemy                          = 0x2A,
    Item                           = 0x2C,
}

export const enum CalcAnimType {
}

export const enum DrawType {
    SWING_ROPE                     = 0x00,
    TRAPEZE                        = 0x06,
    OCEAN_BOWL                     = 0x07,
    OCEAN_RING                     = 0x08,
    OCEAN_RING_OUTSIDE             = 0x0A,
    OCEAN_SPHERE                   = 0x0B,
    ELECTRIC_RAIL_HOLDER           = 0x0E,
    WARP_POD_PATH                  = 0x18,
    WATER_PLANT                    = 0x1B,
    FLAG                           = 0x1D,
    ASTRO_DOME_SKY_CLEAR           = 0x1E,
    ASTRO_DOME_ORBIT               = 0x1F,
    OCEAN_BOWL_BLOOM_DRAWER        = 0x21,
    BLOOM_MODEL                    = 0x36,
    BRIGHT_SUN                     = 0x39,
    WATER_CAMERA_FILTER            = 0x3A,

    EFFECT_DRAW_3D                 = 0x47,
    EFFECT_DRAW_INDIRECT           = 0x48,
    EFFECT_DRAW_AFTER_INDIRECT     = 0x49,
    EFFECT_DRAW_2D                 = 0x4A,
    EFFECT_DRAW_FOR_2D_MODEL       = 0x4B,
    EFFECT_DRAW_FOR_BLOOM_EFFECT   = 0x4C,
    EFFECT_DRAW_AFTER_IMAGE_EFFECT = 0x4D,

    GRAVITY_EXPLAINER              = 0x200,
};

export const enum DrawBufferType {
    SKY                                 = 0x01,
    AIR                                 = 0x02,
    SUN                                 = 0x03,
    PLANET                              = 0x04,
    ENVIRONMENT                         = 0x06,
    ENVIRONMENT_STRONG_LIGHT            = 0x07,
    MAP_OBJ                             = 0x08,
    MAP_OBJ_WEAK_LIGHT                  = 0x09,
    MAP_OBJ_STRONG_LIGHT                = 0x0A,
    NO_SHADOWED_MAP_OBJ                 = 0x0B,
    NO_SHADOWED_MAP_OBJ_STRONG_LIGHT    = 0x0C,
    NO_SILHOUETTED_MAP_OBJ              = 0x0D,
    NO_SILHOUETTED_MAP_OBJ_WEAK_LIGHT   = 0x0E,
    NO_SILHOUETTED_MAP_OBJ_STRONG_LIGHT = 0x0F,
    NPC                                 = 0x10,
    RIDE                                = 0x11,
    ENEMY                               = 0x12,
    ENEMY_DECORATION                    = 0x13,
    MARIO_ACTOR                         = 0x14,
    TORNADO_MARIO                       = 0x15,
    INDIRECT_MAP_OBJ                    = 0x19,
    INDIRECT_MAP_OBJ_STRONG_LIGHT       = 0x1A,
    INDIRECT_NPC                        = 0x1B,
    INDIRECT_ENEMY                      = 0x1C,
    INDIRECT_PLANET                     = 0x1D,
    BLOOM_MODEL                         = 0x1E,
    CRYSTAL                             = 0x20,
    GLARING_LIGHT                       = 0x22,
    ASTRO_DOME_SKY                      = 0x23,
    _3D_MODEL_FOR_2D                    = 0x24,
    MIRROR_MAP_OBJ                      = 0x27,
}

export const enum OpaXlu {
    OPA, XLU,
}

export const enum FilterKeyBase {
    DRAW_BUFFER_OPA = 0x0200,
    DRAW_BUFFER_XLU = 0x0100,

    EXECUTE         = 0x2000,
}

export function createFilterKeyForDrawBufferType(xlu: OpaXlu, drawBufferType: DrawBufferType): number {
    if (xlu === OpaXlu.OPA)
        return FilterKeyBase.DRAW_BUFFER_OPA | drawBufferType;
    else
        return FilterKeyBase.DRAW_BUFFER_XLU | drawBufferType;
}

export function createFilterKeyForDrawType(drawType: DrawType): number {
    return FilterKeyBase.EXECUTE | drawType;
}

export class NameObj {
    public nameObjExecuteInfoIndex: number = -1;

    constructor(sceneObjHolder: SceneObjHolder, public name: string) {
        sceneObjHolder.nameObjHolder.add(this);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        // Default implementation; nothing.
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        // Default implementation; nothing.
    }

    public calcAnim(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        // Default implementation; nothing.
    }

    public calcViewAndEntry(sceneObjHolder: SceneObjHolder, camera: Camera | null, viewMatrix: mat4 | null): void {
        // Default implementation; nothing.
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        // Default implementation; nothing.
    }

    // Noclip-specific hook to implement scenario changing.
    public scenarioChanged(sceneObjHolder: SceneObjHolder): void {
        // Default implementation; nothing.
    }

    // Noclip-specific hook to destroy any dynamically created GPU data.
    public destroy(device: GfxDevice): void {
        // Default implementation; nothing.
    }

    // Noclip-specific hook to fetch any needed archives.
    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        // Default implementation; nothing.
    }
}

class NameObjExecuteInfo {
    public nameObj: NameObj;
    public calcAnimType: CalcAnimType;
    public drawBufferType: DrawBufferType;
    public drawBufferIndex: number;
    public movementType: MovementType;
    public drawType: DrawType;

    public setConnectInfo(scn: SceneNameObjListExecutor, actor: NameObj, movementType: MovementType, calcAnimType: CalcAnimType, drawBufferType: DrawBufferType, drawType: DrawType): void {
        this.nameObj = actor;
        this.movementType = movementType;
        this.calcAnimType = calcAnimType;
        this.drawBufferType = drawBufferType;
        this.drawType = drawType;

        if (drawBufferType !== -1) {
            // NameObjListExecutor::registerDrawBuffer
            this.drawBufferIndex = scn.drawBufferHolder.registerDrawBuffer(actor as LiveActor, drawBufferType);
        }
    }
}

export class NameObjGroup<T extends NameObj> extends NameObj {
    public objArray: T[] = [];

    constructor(sceneObjHolder: SceneObjHolder, name: string, private maxCount: number) {
        super(sceneObjHolder, name);
    }

    protected registerObj(obj: T): void {
        this.objArray.push(obj);

        assert(this.objArray.length <= this.maxCount);
    }
}

export class NameObjHolder {
    public nameObjs: NameObj[] = [];

    public add(nameObj: NameObj): void {
        this.nameObjs.push(nameObj);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.nameObjs.length; i++)
            this.nameObjs[i].initAfterPlacement(sceneObjHolder);
    }

    public scenarioChanged(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.nameObjs.length; i++)
            this.nameObjs[i].scenarioChanged(sceneObjHolder);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.nameObjs.length; i++)
            this.nameObjs[i].destroy(device);
    }
}

// This is also NameObjExecuteHolder and NameObjListExecutor for our purposes... at least for now.
export class SceneNameObjListExecutor {
    public drawBufferHolder: DrawBufferHolder;
    public nameObjExecuteInfos: NameObjExecuteInfo[] = [];

    constructor() {
        this.drawBufferHolder = new DrawBufferHolder(drawBufferInitialTable);
    }

    // NameObjExecuteHolder::registerActor
    public registerActor(actor: NameObj, movementType: MovementType, calcAnimType: CalcAnimType, drawBufferType: DrawBufferType, drawType: DrawType): void {
        const info = new NameObjExecuteInfo();
        info.setConnectInfo(this, actor, movementType, calcAnimType, drawBufferType, drawType);
        actor.nameObjExecuteInfoIndex = this.nameObjExecuteInfos.length;
        this.nameObjExecuteInfos.push(info);
    }

    // NameObjListExecutor::findLightInfo
    public findLightInfo(actor: LiveActor): void {
        const info = this.nameObjExecuteInfos[actor.nameObjExecuteInfoIndex];
        return this.drawBufferHolder.findLightInfo(info.nameObj as LiveActor, info.drawBufferType, info.drawBufferIndex);
    }

    // Hack for the lack of individual DrawBuffer execution.
    public findLightType(actor: LiveActor): LightType {
        const info = this.nameObjExecuteInfos[actor.nameObjExecuteInfoIndex];
        return this.drawBufferHolder.findLightType(info.drawBufferType);
    }

    public executeMovement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        for (let i = 0; i < this.nameObjExecuteInfos.length; i++)
            if (this.nameObjExecuteInfos[i].movementType !== -1)
                this.nameObjExecuteInfos[i].nameObj.movement(sceneObjHolder, viewerInput);
    }

    public executeCalcAnim(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        for (let i = 0; i < this.nameObjExecuteInfos.length; i++)
            if (this.nameObjExecuteInfos[i].calcAnimType !== -1)
                this.nameObjExecuteInfos[i].nameObj.calcAnim(sceneObjHolder, viewerInput);
    }

    public executeDrawAll(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        for (let i = 0; i < this.nameObjExecuteInfos.length; i++) {
            const executeInfo = this.nameObjExecuteInfos[i];
            const nameObj = executeInfo.nameObj;

            if (this.nameObjExecuteInfos[i].drawBufferType !== -1) {
                // HACK: Supply an ortho view matrix for 2D camera types.
                // Need to find a better place to put this... executeDrawAll is a hack...

                const group = this.drawBufferHolder.groups[this.nameObjExecuteInfos[i].drawBufferType];
                if (group.tableEntry.DrawCameraType === DrawCameraType.DrawCameraType_3D)
                    nameObj.calcViewAndEntry(sceneObjHolder, viewerInput.camera, viewerInput.camera.viewMatrix);
                else if (group.tableEntry.DrawCameraType === DrawCameraType.DrawCameraType_2D)
                    nameObj.calcViewAndEntry(sceneObjHolder, null, null);
                else
                    throw "whoops";
            }

            if (this.nameObjExecuteInfos[i].drawType !== -1) {
                // If this is an execute draw, then set up our filter key correctly...
                const template = renderInstManager.pushTemplateRenderInst();
                template.filterKey = createFilterKeyForDrawType(executeInfo.drawType);
                // By default, the scene params are 3D.
                template.setUniformBufferOffset(ub_SceneParams, sceneObjHolder.renderParams.sceneParamsOffs3D, ub_SceneParamsBufferSize);
                nameObj.draw(sceneObjHolder, renderInstManager, viewerInput);
                renderInstManager.popTemplateRenderInst();
            }
        }
    }

    public drawAllBuffers(device: GfxDevice, renderInstManager: GfxRenderInstManager, camera: Camera, viewport: NormalizedViewportCoords, cameraType: DrawCameraType): void {
        this.drawBufferHolder.drawAllBuffers(device, renderInstManager, camera, viewport, cameraType);
    }

    public drawBufferHasVisible(drawBufferType: DrawBufferType): boolean {
        return this.drawBufferHolder.drawBufferHasVisible(drawBufferType);
    }
}

export class NameObjAdaptor extends NameObj {
    public calcAnimCallback: ((sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput) => void) | null = null;
    public calcViewAndEntryCallback: ((sceneObjHolder: SceneObjHolder, camera: Camera | null, viewMatrix: mat4 | null) => void) | null = null;
    public movementCallback: ((sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput) => void) | null = null;
    public drawCallback: ((sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput) => void) | null = null;

    public calcAnim(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        if (this.calcAnimCallback !== null)
            this.calcAnimCallback(sceneObjHolder, viewerInput);
    }

    public calcViewAndEntry(sceneObjHolder: SceneObjHolder, camera: Camera | null, viewMatrix: mat4 | null): void {
        if (this.calcViewAndEntryCallback !== null)
            this.calcViewAndEntryCallback(sceneObjHolder, camera, viewMatrix);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        if (this.movementCallback !== null)
            this.movementCallback(sceneObjHolder, viewerInput);
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (this.drawCallback !== null)
            this.drawCallback(sceneObjHolder, renderInstManager, viewerInput);
    }
}
