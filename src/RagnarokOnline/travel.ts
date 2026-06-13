import { mat4 } from "gl-matrix";
import { btoa } from "../Ascii85.js";
import { SceneLoader } from "../SceneBase.js";
import { serializeMat4_V2_V3 } from "../SaveState.js";

const SCENE_GROUP_ID = "RagnarokOnline";

const STATE_BYTES = 1 + 48 + 1 + 4;
const scratch = new Uint8Array(STATE_BYTES);
const scratchView = new DataView(scratch.buffer);

export function triggerTravel(sceneLoader: SceneLoader, destMapId: string, arrivalCellX: number | undefined, arrivalCellY: number | undefined, sourceCameraWorldMatrix: mat4): void {
    scratchView.setUint8(0, 0);
    serializeMat4_V2_V3(scratchView, 1, sourceCameraWorldMatrix);
    let byteLength = 1 + 48;
    if (arrivalCellX !== undefined && arrivalCellY !== undefined) {
        scratchView.setUint8(byteLength++, 1);
        scratchView.setInt16(byteLength, arrivalCellX, true); byteLength += 2;
        scratchView.setInt16(byteLength, arrivalCellY, true); byteLength += 2;
    }
    sceneLoader.loadSceneById(SCENE_GROUP_ID, destMapId, `A${btoa(scratch, byteLength)}`);
}
