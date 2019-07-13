
import { ProgressMeter } from "./Progressable";
import { GfxDevice } from "./gfx/platform/GfxPlatform";
import { SceneGfx } from "./viewer";

export interface SceneContext {
    device: GfxDevice;
    abortSignal: AbortSignal;
    progressMeter: ProgressMeter;
    uiContainer: HTMLElement;
}

export interface SceneDesc {
    id: string;
    name: string;
    createScene(device: GfxDevice, abortSignal: AbortSignal, sceneContext: SceneContext): PromiseLike<SceneGfx>;
}

export interface SceneGroup {
    id: string;
    name: string;
    sceneDescs: (string | SceneDesc)[];
    sceneIdMap?: Map<string, string>;
}

export function getSceneDescs(sceneGroup: SceneGroup): SceneDesc[] {
    return sceneGroup.sceneDescs.filter((g) => typeof g !== 'string') as SceneDesc[];
}