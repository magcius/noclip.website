
import { GfxDevice } from "./gfx/platform/GfxPlatform.js";
import { SceneGfx, ViewerRenderInput } from "./viewer.js";
import { DataFetcher } from "./DataFetcher.js";
import { DataShare } from "./DataShare.js";
import { GfxRenderInstManager } from "./gfx/render/GfxRenderInstManager.js";
import InputManager from "./InputManager.js";

export interface ProgressMeter {
    setProgress(progress: number): void;
    loadProgress: number;
}

export interface Destroyable {
    destroy(device: GfxDevice): void;
}

export interface GraphObjBase extends Destroyable {
    prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void;
}

export interface SceneContext {
    device: GfxDevice;
    dataFetcher: DataFetcher;
    dataShare: DataShare;
    uiContainer: HTMLElement;
    destroyablePool: Destroyable[];
    inputManager: InputManager;
    viewerInput: ViewerRenderInput;
    initialSceneTime: number;
}

export interface SceneDesc {
    id: string;
    name: string;
    createScene(device: GfxDevice, sceneContext: SceneContext): PromiseLike<SceneGfx>;
    hidden?: boolean;
}

export interface SceneGroup {
    id: string;
    name: string;
    sceneDescs: (string | SceneDesc)[];
    sceneIdMap?: Map<string, string>;
    hidden?: boolean;
    altName?: string;
}
