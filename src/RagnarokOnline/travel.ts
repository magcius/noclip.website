
// Warp click-to-travel. Hands the destination + arrival cell to the engine's
// SceneLoader as a v3 save state so the dest scene gets cellX/Y via its own
// deserializeSaveState. The framework handles the URL/camera plumbing.

import { mat4 } from "gl-matrix";
import { btoa } from "../Ascii85.js";
import { serializeMat4 } from "../Camera.js";
import { SceneLoader } from "../SceneBase.js";

const SCENE_GROUP_ID = "RagnarokOnline";

// v3 save state: 1 byte optionsBits + 48 bytes camera + 4 bytes scene (cellX/cellY i16).
const STATE_BYTES = 1 + 48 + 4;
const scratch = new Uint8Array(STATE_BYTES);
const scratchView = new DataView(scratch.buffer);

export function triggerTravel(sceneLoader: SceneLoader, destMapId: string, arrivalCellX: number | undefined, arrivalCellY: number | undefined, sourceCameraWorldMatrix: mat4): void {
    scratchView.setUint8(0, 0);  // optionsBits
    serializeMat4(scratchView, 1, sourceCameraWorldMatrix);  // 48 bytes
    let byteLength = 1 + 48;
    if (arrivalCellX !== undefined && arrivalCellY !== undefined) {
        scratchView.setInt16(49, arrivalCellX, true);
        scratchView.setInt16(51, arrivalCellY, true);
        byteLength = STATE_BYTES;
    }
    sceneLoader.loadSceneById(SCENE_GROUP_ID, destMapId, `A${btoa(scratch, byteLength)}`);
}
