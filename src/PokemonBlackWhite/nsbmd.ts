import { mat4 } from 'gl-matrix';
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { MDL0Model, parseNSBMD, parseResDict } from '../nns_g3d/NNS_G3D.js';
import { assert } from '../util.js';

export const inverseBindMatrices = new WeakMap<MDL0Model, mat4[]>();

export function parseModel(buffer: ArrayBufferSlice) {
    const bmd = parseNSBMD(buffer), view = buffer.createDataView(), block = view.getUint32(16, true);
    const entries = parseResDict(buffer, block + 8);
    for (let i = 0; i < entries.length; i++) {
        const start = block + entries[i].value, model = bmd.models[i];
        const nodes = parseResDict(buffer, start + 0x40);
        for (let j = 0; j < nodes.length; j++) {
            const p = start + 0x40 + nodes[j].value, flags = view.getUint16(p, true);
            if (flags & 4) continue;
            const at = p + 4 + (flags & 1 ? 0 : 12) + (flags & 2 ? 0 : flags & 8 ? 4 : 16);
            const scale: [number, number, number] = [view.getInt32(at, true) / 4096, view.getInt32(at + 4, true) / 4096, view.getInt32(at + 8, true) / 4096];
            mat4.scale(model.nodes[j].jointMatrix, model.nodes[j].jointMatrix, scale);
        }
        const inverseOffset = view.getUint32(start + 16, true), size = view.getUint32(start, true);
        if (inverseOffset === 0 || inverseOffset === size) continue;
        assert(inverseOffset + model.nodes.length * 84 <= size);
        const matrices = model.nodes.map((_, j) => {
            const matrix = mat4.create(), at = start + inverseOffset + j * 84;
            for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) matrix[c * 4 + r] = view.getInt32(at + (c * 3 + r) * 4, true) / 4096;
            return matrix;
        });
        inverseBindMatrices.set(model, matrices);
    }
    return bmd;
}
