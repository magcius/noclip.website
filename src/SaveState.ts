
import { mat4, quat, ReadonlyMat4 } from "gl-matrix";
import ArrayBufferSlice from "./ArrayBufferSlice";
import { atob, btoa } from "./Ascii85";
import { Mat4Identity, MathConstants, Vec3UnitX, Vec3UnitY } from "./MathHelpers";
import { assert } from "./util";

export interface SaveState {
    cameraWorldMatrix: mat4;
    sceneData: ArrayBufferSlice | null;
    fovY?: number;
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

const scratchQuat = quat.create();
function compressFrame_V1(view: DataView, byteOffs: number, m: ReadonlyMat4): number {
    // 3 floats for position + 32-bit quaternion for rotation = 16 bytes
    view.setFloat32(byteOffs + 0x00, m[12], true);
    view.setFloat32(byteOffs + 0x04, m[13], true);
    view.setFloat32(byteOffs + 0x08, m[14], true);

    const q = scratchQuat;
    mat4.getRotation(q, m);

    // https://marc-b-reynolds.github.io/quaternions/2017/05/02/QuatQuantPart1.html#basic-half-angle-leftsqrtqright_2
    const s = Math.sqrt(1.0 + q[3]);

    // Values are in range [-1, sqrt2].
    const x = ((q[0] / s) + 1.0) / (1.0 + Math.SQRT2) * 0x3FF;
    const y = ((q[1] / s) + 1.0) / (1.0 + Math.SQRT2) * 0xFFF;
    const z = ((q[2] / s) + 1.0) / (1.0 + Math.SQRT2) * 0x3FF;

    assert(x >= 0 && x < 0x3FF);
    assert(y >= 0 && y < 0xFFF);
    assert(z >= 0 && z < 0x3FF);

    const qn = x << 22 | y << 10 | z;
    view.setUint32(byteOffs + 0x0C, qn, true);
    return 4*4;
}

function removeSmallAmountsOfRoll(m: mat4): void {
    // Compression can add unwanted camera roll, which we're very sensitive to.
    // Check the right vector to make sure it's perfectly horizontal.

    // dot(camera.right, Vec3UnitY) !== 0
    // dot(camera[0,1,2], Vec3UnitY) !== 0
    // camera[1] !== 0
    if (Math.abs(m[1]) >= 0.005) {
        // Oops, we have some roll. Correct the right vector.
        m[1] = 0.0;
        const len = Math.hypot(m[0], m[2]);
        m[0] /= len;
        m[2] /= len;

        // Now recompute the up vector with fwd x right. Inline cross product assuming m[1] = 0.
        m[4] = m[9] * m[2];
        m[5] = m[10] * m[0] - m[8] * m[2];
        m[6] = -m[9] * m[0];
    }
}

function decompressFrame_V1(m: mat4, view: DataView, byteOffs: number): number {
    const qn = view.getUint32(byteOffs + 0x0C, true);

    const x = (((qn >>> 22) & 0x3FF) / 0x3FF) * (1.0 + Math.SQRT2) - 1.0;
    const y = (((qn >>> 10) & 0xFFF) / 0xFFF) * (1.0 + Math.SQRT2) - 1.0;
    const z = (((qn >>>  0) & 0x3FF) / 0x3FF) * (1.0 + Math.SQRT2) - 1.0;

    const d = x*x + y*y + z*z;
    const s = Math.sqrt(2.0 - d);

    const q = scratchQuat;
    quat.set(q, x*s, y*s, z*s, 1.0 - d);
    mat4.fromQuat(m, q);
    removeSmallAmountsOfRoll(m);

    m[12] = view.getFloat32(byteOffs + 0x00, true);
    m[13] = view.getFloat32(byteOffs + 0x04, true);
    m[14] = view.getFloat32(byteOffs + 0x08, true);
    return 4*4;
}

function compressFrame_V2(view: DataView, byteOffs: number, m: ReadonlyMat4): number | null {
    // Does not support roll.
    if (Math.abs(m[1]) > 0.05)
        return null;

    // Extract the yaw from the right vector.
    // atan2 returns between -tau/2 and tau/2
    const a = (((-Math.atan2(m[2], m[0]) / MathConstants.TAU) + 1.0) % 1.0) * 0xFF;
    // Extract the pitch from the forward vector.
    const b = (((-Math.atan2(m[9], Math.hypot(m[8], m[10])) / MathConstants.TAU) + 1.0) % 1.0) * 0xFF;

    view.setFloat32(byteOffs + 0x00, m[12], true);
    view.setFloat32(byteOffs + 0x04, m[13], true);
    view.setFloat32(byteOffs + 0x08, m[14], true);

    const ab = a << 8 | b;
    view.setUint16(byteOffs + 0x0C, ab, true);

    return 0x0E;
}

function decompressFrame_V2(m: mat4, view: DataView, byteOffs: number): number {
    // Extract the two angles.
    const ab = view.getUint16(byteOffs + 0x0C, true);

    const a = (ab >>> 8) * MathConstants.TAU / 0xFF;
    const b = (ab & 0xFF) * MathConstants.TAU / 0xFF;
    // First rotate around world up (yaw), then rotate around right (pitch).
    mat4.rotate(m, Mat4Identity, a, Vec3UnitY);
    mat4.rotate(m, m, b, Vec3UnitX);

    m[12] = view.getFloat32(byteOffs + 0x00, true);
    m[13] = view.getFloat32(byteOffs + 0x04, true);
    m[14] = view.getFloat32(byteOffs + 0x08, true);
    return 0x0E;
}

enum OptionsBitsV3 {
    None             = 0b0000,
    CompressFrame_V1 = 0b0001,
    FovY             = 0b0010,
    CompressFrame_V2 = 0b0100,
}

export class SaveStateSerializer {
    private _saveStateTmp = new Uint8Array(512);
    private _saveStateView = new DataView(this._saveStateTmp.buffer);

    private loadSaveStateV2(dst: SaveState, str: string): boolean {
        const byteLength = atob(this._saveStateTmp, 0, str);

        let byteOffs = 0;
        // const sceneTime = this._saveStateView.getFloat32(byteOffs + 0x00, true);
        byteOffs += 0x04;

        byteOffs += deserializeCameraV2_V3(dst.cameraWorldMatrix, this._saveStateView, byteOffs);
        dst.sceneData = byteOffs < byteLength ? new ArrayBufferSlice(this._saveStateTmp.buffer, byteOffs, byteLength - byteOffs) : null;
        return true;
    }

    private loadSaveStateV3(dst: SaveState, state: string): boolean {
        const byteLength = atob(this._saveStateTmp, 0, state);

        let byteOffs = 0;
        const optionsBits = this._saveStateView.getUint8(byteOffs + 0x00);
        byteOffs++;

        if (optionsBits & OptionsBitsV3.CompressFrame_V2) {
            byteOffs += decompressFrame_V2(dst.cameraWorldMatrix, this._saveStateView, byteOffs);
        } else if (optionsBits & OptionsBitsV3.CompressFrame_V1) {
            byteOffs += decompressFrame_V1(dst.cameraWorldMatrix, this._saveStateView, byteOffs);
        } else {
            byteOffs += deserializeCameraV2_V3(dst.cameraWorldMatrix, this._saveStateView, byteOffs);
        }

        if (optionsBits & OptionsBitsV3.FovY) {
            dst.fovY = this._saveStateView.getInt16(byteOffs, true) / 512;
            byteOffs += 2;
        }

        dst.sceneData = byteOffs < byteLength ? new ArrayBufferSlice(this._saveStateTmp.buffer, byteOffs, byteLength - byteOffs) : null;
        return true;
    }

    public deserializeSaveState(dst: SaveState, str: string): boolean {
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

    public serializeSaveState(saveState: Readonly<SaveState>): string {
        let byteOffs = 1;

        let optionsBits: OptionsBitsV3 = 0;

        const enableCompressFrameV2 = false;
        if (enableCompressFrameV2) {
            const frameSizeV2 = compressFrame_V2(this._saveStateView, byteOffs, saveState.cameraWorldMatrix);
            if (frameSizeV2 !== null) {
                byteOffs += frameSizeV2;
                optionsBits |= OptionsBitsV3.CompressFrame_V2;
            }
        }

        if (optionsBits === 0) {
            byteOffs += compressFrame_V1(this._saveStateView, byteOffs, saveState.cameraWorldMatrix);
            optionsBits |= OptionsBitsV3.CompressFrame_V1;
        }

        if (saveState.fovY !== undefined) {
            optionsBits |= OptionsBitsV3.FovY;
            this._saveStateView.setUint16(byteOffs, saveState.fovY * 512, true);
            byteOffs += 2;
        }

        if (saveState.sceneData !== null) {
            this._saveStateTmp.set(saveState.sceneData.createTypedArray(Uint8Array), byteOffs);
            byteOffs += saveState.sceneData.byteLength;
        }

        this._saveStateView.setUint8(0, optionsBits);

        const s = btoa(this._saveStateTmp, byteOffs);
        return `ShareData=${s}`;
    }
}
