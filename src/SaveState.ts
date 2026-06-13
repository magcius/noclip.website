
import { mat4 } from "gl-matrix";
import ArrayBufferSlice from "./ArrayBufferSlice";
import { atob, btoa } from "./Ascii85";
import { assert } from "./util";

export interface SaveState {
    sceneTime: number;
    cameraWorldMatrix: mat4;
    extraData: ArrayBufferSlice | null;
}

function deserializeCameraV2_V3(m: mat4, view: DataView, byteOffs: number): number {
    m[0]  = view.getFloat32(byteOffs + 0x00, true);
    m[4]  = view.getFloat32(byteOffs + 0x04, true);
    m[8]  = view.getFloat32(byteOffs + 0x08, true);
    m[12] = view.getFloat32(byteOffs + 0x0C, true);
    m[1]  = view.getFloat32(byteOffs + 0x10, true);
    m[5]  = view.getFloat32(byteOffs + 0x14, true);
    m[9]  = view.getFloat32(byteOffs + 0x18, true);
    m[13] = view.getFloat32(byteOffs + 0x1C, true);
    m[2]  = view.getFloat32(byteOffs + 0x20, true);
    m[6]  = view.getFloat32(byteOffs + 0x24, true);
    m[10] = view.getFloat32(byteOffs + 0x28, true);
    m[14] = view.getFloat32(byteOffs + 0x2C, true);
    m[3]  = 0;
    m[7]  = 0;
    m[11] = 0;
    m[15] = 1;
    return 0x04*4*3;
}

export function serializeMat4_V2_V3(view: DataView, byteOffs: number, m: mat4): number {
    view.setFloat32(byteOffs + 0x00, m[0],  true);
    view.setFloat32(byteOffs + 0x04, m[4],  true);
    view.setFloat32(byteOffs + 0x08, m[8],  true);
    view.setFloat32(byteOffs + 0x0C, m[12], true);
    view.setFloat32(byteOffs + 0x10, m[1],  true);
    view.setFloat32(byteOffs + 0x14, m[5],  true);
    view.setFloat32(byteOffs + 0x18, m[9],  true);
    view.setFloat32(byteOffs + 0x1C, m[13], true);
    view.setFloat32(byteOffs + 0x20, m[2],  true);
    view.setFloat32(byteOffs + 0x24, m[6],  true);
    view.setFloat32(byteOffs + 0x28, m[10], true);
    view.setFloat32(byteOffs + 0x2C, m[14], true);
    return 0x04*4*3;
}

export class SaveStateSerializer {
    private _saveStateTmp = new Uint8Array(512);
    private _saveStateView = new DataView(this._saveStateTmp.buffer);

    private loadSaveStateV2(dst: SaveState, str: string): boolean {
        const byteLength = atob(this._saveStateTmp, 0, str);

        let byteOffs = 0;
        dst.sceneTime = this._saveStateView.getFloat32(byteOffs + 0x00, true);
        byteOffs += 0x04;

        byteOffs += deserializeCameraV2_V3(dst.cameraWorldMatrix, this._saveStateView, byteOffs);
        dst.extraData = byteOffs < byteLength ? new ArrayBufferSlice(this._saveStateTmp.buffer, byteOffs, byteLength - byteOffs) : null;
        return true;
    }

    private loadSaveStateV3(dst: SaveState, state: string): boolean {
        const byteLength = atob(this._saveStateTmp, 0, state);

        let byteOffs = 0;
        const optionsBits = this._saveStateView.getUint8(byteOffs + 0x00);
        assert(optionsBits === 0);
        byteOffs++;

        dst.sceneTime = 0; // Scene time not serialized in V3
        byteOffs += deserializeCameraV2_V3(dst.cameraWorldMatrix, this._saveStateView, byteOffs);
        dst.extraData = byteOffs < byteLength ? new ArrayBufferSlice(this._saveStateTmp.buffer, byteOffs, byteLength - byteOffs) : null;
        return true;
    }

    public loadSaveState(dst: SaveState, str: string): boolean {
        // Version 2 starts with ZNCA8, which is Ascii85 for 'NC\0\0'
        if (str.startsWith('ZNCA8') && str.endsWith('='))
            return this.loadSaveStateV2(dst, str.slice(5, -1));

        // Version 3 starts with 'A' and has no '=' at the end.
        if (str.startsWith('A'))
            return this.loadSaveStateV3(dst, str.slice(1));

        if (str.startsWith('ShareData='))
            return this.loadSaveStateV3(dst, str.slice(10));

        return false;
    }

    public getSaveState(saveState: Readonly<SaveState>): string {
        let byteOffs = 0;

        const optionsBits = 0;
        this._saveStateView.setUint8(byteOffs, optionsBits);
        byteOffs++;

        byteOffs += serializeMat4_V2_V3(this._saveStateView, byteOffs, saveState.cameraWorldMatrix);

        if (saveState.extraData !== null) {
            this._saveStateTmp.set(saveState.extraData.createTypedArray(Uint8Array), byteOffs);
            byteOffs += saveState.extraData.byteLength;
        }

        const s = btoa(this._saveStateTmp, byteOffs);
        return `ShareData=${s}`;
    }
}
