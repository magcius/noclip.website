
// Warp click-to-travel. Encodes the destination cell into the scene save state
// hash (`#<group>/<dest>;A<state>`) so a fresh scene receives the arrival cell
// through the URL — no module-level channel.

import { mat4 } from "gl-matrix";
import { btoa } from "../Ascii85.js";
import { serializeMat4 } from "../Camera.js";

const SCENE_GROUP_ID = "RagnarokOnline";

// v3 save state: 1 byte optionsBits + 48 bytes camera + 4 bytes scene (cellX/cellY i16).
const STATE_BYTES = 1 + 48 + 4;
const scratch = new Uint8Array(STATE_BYTES);
const scratchView = new DataView(scratch.buffer);

export function triggerTravel(destMapId: string, arrivalCellX: number | undefined, arrivalCellY: number | undefined, sourceCameraWorldMatrix: mat4): void {
    let byteLength: number;
    if (arrivalCellX !== undefined && arrivalCellY !== undefined) {
        scratchView.setUint8(0, 0);  // optionsBits
        serializeMat4(scratchView, 1, sourceCameraWorldMatrix);  // 48 bytes
        scratchView.setInt16(49, arrivalCellX, true);
        scratchView.setInt16(51, arrivalCellY, true);
        byteLength = STATE_BYTES;
    } else {
        // No arrival cell — encode just the camera prefix so the destination
        // starts with a sensible (but defaultable) view.
        scratchView.setUint8(0, 0);
        serializeMat4(scratchView, 1, sourceCameraWorldMatrix);
        byteLength = 1 + 48;
    }

    const encoded = btoa(scratch, byteLength);
    const hash = `#${SCENE_GROUP_ID}/${destMapId};A${encoded}`;
    if (window.location.hash === hash)
        return;
    window.location.hash = hash;
}
