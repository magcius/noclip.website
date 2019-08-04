
import { GfxDevice } from "./gfx/platform/GfxPlatform";
import { SceneGfx } from "./viewer";
import { DataFetcher } from "./DataFetcher";

export interface ProgressMeter {
    setProgress(progress: number): void;
}

export interface Destroyable {
    destroy(device: GfxDevice): void;
}

export interface SceneContext {
    device: GfxDevice;
    dataFetcher: DataFetcher;
    uiContainer: HTMLElement;
    destroyablePool: Destroyable[];
}

export interface SceneDesc {
    id: string;
    name: string;
    createScene(device: GfxDevice, sceneContext: SceneContext): PromiseLike<SceneGfx>;
}

export interface SceneGroup {
    id: string;
    name: string;
    sceneDescs: (string | SceneDesc)[];
    sceneIdMap?: Map<string, string>;
    hidden?: boolean;
}

export function getSceneDescs(sceneGroup: SceneGroup): SceneDesc[] {
    return sceneGroup.sceneDescs.filter((g) => typeof g !== 'string') as SceneDesc[];
}
