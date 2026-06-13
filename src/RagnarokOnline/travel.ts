
import { mat4 } from "gl-matrix";
import { SceneLoader } from "../SceneBase.js";
import { SaveState } from "../SaveState.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";

const SCENE_GROUP_ID = "RagnarokOnline";

export function triggerTravel(sceneLoader: SceneLoader, destMapId: string, arrivalCellX: number | undefined, arrivalCellY: number | undefined, sourceCameraWorldMatrix: mat4): void {
    let extraData: ArrayBufferSlice | null = null;
    if (arrivalCellX !== undefined && arrivalCellY !== undefined) {
        extraData = new ArrayBufferSlice(new ArrayBuffer(5));
        const view = extraData.createDataView();
        view.setUint8(0, 1);
        view.setInt16(1, arrivalCellX, true);
        view.setInt16(3, arrivalCellY, true);
    }

    const saveState: SaveState = {
        cameraWorldMatrix: sourceCameraWorldMatrix,
        sceneData: extraData,
    };

    sceneLoader.loadSceneById(SCENE_GROUP_ID, destMapId, saveState);
}
