
import { DrawBufferHolder, drawBufferInitialTable, LightType } from "./DrawBuffer";
import { LiveActor, SceneObjHolder } from "./smg_scenes";
import { ViewerRenderInput } from "../../viewer";
import { GfxTexture, GfxDevice } from "../../gfx/platform/GfxPlatform";
import { GXRenderHelperGfx } from "../../gx/gx_render_2";
import { Camera } from "../../Camera";

export const enum MovementType {
}

export const enum CalcAnimType {
}

export const enum DrawType {
}

export const enum DrawBufferType {
    NPC = 0x10,
    NPC_INDIRECT = 0x1B,
}

export class NameObj {
    public nameObjExecuteInfoIndex: number = -1;

    constructor(public name: string) {
    }

    public draw(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
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

    public executeDrawAll(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        for (let i = 0; i < this.nameObjExecuteInfos.length; i++) {
            const nameObj = this.nameObjExecuteInfos[i].nameObj;
            nameObj.draw(sceneObjHolder, viewerInput);
        }
    }

    public drawAllBuffers(device: GfxDevice, renderHelper: GXRenderHelperGfx, camera: Camera): void {
        this.drawBufferHolder.drawAllBuffers(device, renderHelper, camera);
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
