import { mat4, quat, vec3 } from 'gl-matrix';
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { MDL0Model, parseResDict } from '../nns_g3d/NNS_G3D.js';
import { assert, readString } from '../util.js';

type Track<T> = { values: T[]; step: number };
interface JointTrack {
    id: number;
    translation?: Track<number>[];
    rotation?: Track<quat>;
    scale?: Track<number>[];
}
export interface JointAnimation { duration: number; joints: JointTrack[]; }

export function parseJointAnimation(buffer: ArrayBufferSlice): JointAnimation {
    const file = buffer.createDataView();
    assert(readString(buffer, 0, 4) === 'BCA0' && file.getUint32(8, true) === buffer.byteLength);
    const block = file.getUint32(16, true);
    assert(readString(buffer, block, 4) === 'JNT0');
    const entries = parseResDict(buffer, block + 8);
    assert(entries.length === 1);
    const data = buffer.slice(block + entries[0].value), v = data.createDataView();
    assert(readString(data, 0, 4, false) === 'J\x00AC');
    const duration = v.getUint16(4, true), count = v.getUint16(6, true);
    const pivot = v.getUint32(12, true), basis = v.getUint32(16, true);
    const rotation = (index: number): quat => {
        const m = new Float32Array(9);
        if (index & 0x8000) {
            const p = pivot + (index & 0x7fff) * 6, flags = v.getUint16(p, true), cell = flags & 15;
            assert(cell < 9);
            const a = v.getInt16(p + 2, true) / 4096, b = v.getInt16(p + 4, true) / 4096;
            const values = [a, b, flags & 32 ? -b : b, flags & 64 ? -a : a];
            let k = 0;
            for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++)
                if (c !== Math.floor(cell / 3) && r !== cell % 3) m[c * 3 + r] = values[k++];
            m[cell] = flags & 16 ? -1 : 1;
        } else {
            const p = basis + index * 10;
            const values = Array.from({ length: 5 }, (_, i) => v.getInt16(p + i * 2, true));
            for (let i = 0; i < 5; i++) m[i] = (values[i] >> 3) / 4096;
            m[5] = (((values[4] << 31) >> 19) | ((values[0] & 7) << 9) | ((values[1] & 7) << 6) | ((values[2] & 7) << 3) | (values[3] & 7)) / 4096;
            const cross = vec3.cross(vec3.create(), m.subarray(0, 3), m.subarray(3, 6));
            m.set(cross, 6);
        }
        return quat.normalize(quat.create(), quat.fromMat3(quat.create(), m));
    };
    const joints = Array.from({ length: count }, (_, i) => {
        let p = v.getUint16(20 + i * 2, true);
        const flags = v.getUint32(p, true); p += 4;
        const joint: JointTrack = { id: flags >>> 24 };
        const scalar = (constant: boolean, scale: boolean): Track<number> => {
            if (constant) {
                const value = v.getInt32(p, true) / 4096; p += scale ? 8 : 4;
                return { values: [value], step: 1 };
            }
            const info = v.getUint32(p, true), offset = v.getUint32(p + 4, true); p += 8;
            const step = 1 << (info >>> 30), size = info & 0x20000000 ? 2 : 4;
            const values = Array.from({ length: Math.ceil(duration / step) }, (_, f) => {
                const at = offset + f * size * (scale ? 2 : 1);
                return (size === 2 ? v.getInt16(at, true) : v.getInt32(at, true)) / 4096;
            });
            return { values, step };
        };
        if (flags & 1) return { id: joint.id, translation: [0, 0, 0].map((n) => ({ values: [n], step: 1 })), rotation: { values: [quat.create()], step: 1 }, scale: [1, 1, 1].map((n) => ({ values: [n], step: 1 })) };
        if (!(flags & 4)) joint.translation = [0, 1, 2].map((axis) => flags & 2 ? { values: [0], step: 1 } : scalar(!!(flags & (8 << axis)), false));
        if (!(flags & 128)) {
            if (flags & 64) joint.rotation = { values: [quat.create()], step: 1 };
            else if (flags & 256) { joint.rotation = { values: [rotation(v.getUint32(p, true))], step: 1 }; p += 4; }
            else {
                const info = v.getUint32(p, true), offset = v.getUint32(p + 4, true); p += 8;
                const step = 1 << (info >>> 30);
                joint.rotation = { values: Array.from({ length: Math.ceil(duration / step) }, (_, f) => rotation(v.getUint16(offset + f * 2, true))), step };
            }
        }
        if (!(flags & 1024)) joint.scale = [0, 1, 2].map((axis) => flags & 512 ? { values: [1], step: 1 } : scalar(!!(flags & (2048 << axis)), true));
        return joint;
    });
    assert(duration > 0);
    return { duration, joints };
}

export function sampleJointAnimation(animation: JointAnimation, model: MDL0Model, time: number): mat4[] {
    const frame = ((time % animation.duration) + animation.duration) % animation.duration;
    const matrices = model.nodes.map((n) => mat4.clone(n.jointMatrix));
    const sample = (track: Track<number>) => {
        if (track.values.length === 1) return track.values[0];
        const f = frame / track.step, i = Math.floor(f), a = track.values[Math.min(i, track.values.length - 1)], b = track.values[Math.min(i + 1, track.values.length - 1)];
        return a + (b - a) * (f - i);
    };
    for (const joint of animation.joints) {
        assert(joint.id < matrices.length);
        const matrix = matrices[joint.id], t = mat4.getTranslation(vec3.create(), matrix), s = mat4.getScaling(vec3.create(), matrix), r = mat4.getRotation(quat.create(), matrix);
        if (joint.translation) for (let i = 0; i < 3; i++) t[i] = sample(joint.translation[i]);
        if (joint.scale) for (let i = 0; i < 3; i++) s[i] = sample(joint.scale[i]);
        if (joint.rotation) {
            const track = joint.rotation, f = frame / track.step, i = Math.floor(f);
            quat.slerp(r, track.values[Math.min(i, track.values.length - 1)], track.values[Math.min(i + 1, track.values.length - 1)], f - i);
        }
        mat4.fromRotationTranslationScale(matrix, r, t, s);
    }
    return matrices;
}
