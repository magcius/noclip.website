
import { GfxDevice } from "./gfx/platform/GfxPlatform";
import { SceneGfx } from "./viewer";
import { DataFetcher } from "./DataFetcher";

export interface ProgressMeter {
    setProgress(progress: number): void;
}

export interface SceneContext {
    device: GfxDevice;
    abortSignal: AbortSignal;
    progressMeter: ProgressMeter;
    dataFetcher: DataFetcher;
    uiContainer: HTMLElement;
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
