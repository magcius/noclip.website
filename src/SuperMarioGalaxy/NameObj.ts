
import { DrawBufferHolder, drawBufferInitialTable, LightType } from "./DrawBuffer";
import { SceneObjHolder } from "./Main";
import { ViewerRenderInput } from "../viewer";
import { GfxTexture, GfxDevice } from "../gfx/platform/GfxPlatform";
import { Camera } from "../Camera";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { LiveActor } from "./LiveActor";
import { NormalizedViewportCoords } from "../gfx/helpers/RenderTargetHelpers";

export const enum MovementType {
}

export const enum CalcAnimType {
}

export const enum DrawType {
    OCEAN_BOWL                     = 0x07,
    WARP_POD_PATH                  = 0x18,
    WATER_CAMERA_FILTER            = 0x3A,

    EFFECT_DRAW_3D                 = 0x47,
    EFFECT_DRAW_INDIRECT           = 0x48,
    EFFECT_DRAW_AFTER_INDIRECT     = 0x49,
    EFFECT_DRAW_2D                 = 0x4A,
    EFFECT_DRAW_FOR_2D_MODEL       = 0x4B,
    EFFECT_DRAW_FOR_BLOOM_EFFECT   = 0x4C,
    EFFECT_DRAW_AFTER_IMAGE_EFFECT = 0x4D,
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
    INDIRECT_MAP_OBJ                    = 0x19,
    INDIRECT_MAP_OBJ_STRONG_LIGHT       = 0x1A,
    INDIRECT_NPC                        = 0x1B,
    INDIRECT_ENEMY                      = 0x1C,
    INDIRECT_PLANET                     = 0x1D,
    BLOOM_MODEL                         = 0x1E,
    CRYSTAL                             = 0x20,
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

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        // Default implementation; nothing.
    }

    public calcAnim(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        // Default implementation; nothing.
    }

    public calcViewAndEntry(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
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

export class NameObjHolder {
    private nameObjs: NameObj[] = [];

    public add(nameObj: NameObj): void {
        this.nameObjs.push(nameObj);
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
    public registerActor(actor: LiveActor, movementType: MovementType, calcAnimType: CalcAnimType, drawBufferType: DrawBufferType, drawType: DrawType): void {
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

            if (this.nameObjExecuteInfos[i].drawBufferType !== -1)
                nameObj.calcViewAndEntry(sceneObjHolder, viewerInput);

            if (this.nameObjExecuteInfos[i].drawType !== -1) {
                // If this is an execute draw, then set up our filter key correctly...
                const template = renderInstManager.pushTemplateRenderInst();
                template.filterKey = createFilterKeyForDrawType(executeInfo.drawType);
                nameObj.draw(sceneObjHolder, renderInstManager, viewerInput);
                renderInstManager.popTemplateRenderInst();
            }
        }
    }

    public drawAllBuffers(device: GfxDevice, renderInstManager: GfxRenderInstManager, camera: Camera, viewport: NormalizedViewportCoords): void {
        this.drawBufferHolder.drawAllBuffers(device, renderInstManager, camera, viewport);
    }

    public drawBufferHasVisible(drawBufferType: DrawBufferType): boolean {
        return this.drawBufferHolder.drawBufferHasVisible(drawBufferType);
    }

    // TODO(jstpierre): Workaround.
    public setIndirectTextureOverride(sceneTexture: GfxTexture): void {
        for (let i = 0; i < this.nameObjExecuteInfos.length; i++) {
            if (this.nameObjExecuteInfos[i].drawBufferType !== -1) {
                const actor = this.nameObjExecuteInfos[i].nameObj as LiveActor;
                actor.setIndirectTextureOverride(sceneTexture);
            }
        }
    }
}
