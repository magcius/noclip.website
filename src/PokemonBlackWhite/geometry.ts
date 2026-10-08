import { mat4, vec3 } from 'gl-matrix';
import { Color } from '../Color.js';
import { MDL0Model, MDL0Shape } from '../nns_g3d/NNS_G3D.js';
import { assertExists } from '../util.js';
import { readCmds, VERTEX_SIZE } from './nitro_gx.js';
import { inverseBindMatrices } from './nsbmd.js';

export interface ModelDraw {
    shape: MDL0Shape;
    materialIndex: number;
    matrices: mat4[];
    currentMatrix: mat4;
}

export function compileModel(model: MDL0Model, joints = model.nodes.map((n) => n.jointMatrix)): ModelDraw[] {
    const view = model.sbcBuffer.createDataView();
    const transforms = model.nodes.map(() => mat4.create());
    const palette: mat4[] = [];
    const draws: ModelDraw[] = [];
    let current = mat4.create();
    let currentMaterial = -1;
    let offset = 0;
    while (offset < view.byteLength) {
        const word = view.getUint8(offset++), command = word & 0x1F, option = word >>> 5;
        if (command === 0) continue;
        if (command === 1) return draws;
        if (command === 2) {
            offset += 2;
        } else if (command === 3) {
            current = mat4.clone(assertExists(palette[view.getUint8(offset++)]));
        } else if (command === 4) {
            currentMaterial = view.getUint8(offset++);
            assertExists(model.materials[currentMaterial]);
        } else if (command === 5) {
            const shape = assertExists(model.shapes[view.getUint8(offset++)]);
            const matrices = palette.map((m) => mat4.clone(m));
            draws.push({ shape, materialIndex: currentMaterial, matrices, currentMatrix: mat4.clone(current) });
        } else if (command === 6) {
            const node = view.getUint8(offset++), parent = view.getUint8(offset++);
            offset++;
            const destination = option & 1 ? view.getUint8(offset++) : -1;
            const source = option & 2 ? view.getUint8(offset++) : -1;
            const base = source >= 0 ? assertExists(palette[source]) : node === parent ? mat4.create() : assertExists(transforms[parent]);
            mat4.mul(transforms[node], base, joints[node]);
            current = mat4.clone(transforms[node]);
            if (destination >= 0) palette[destination] = mat4.clone(current);
        } else if (command === 7 || command === 8) {
            offset++;
            const destination = option & 1 ? view.getUint8(offset++) : -1;
            const source = option & 2 ? view.getUint8(offset++) : -1;
            if (source >= 0) current = mat4.clone(assertExists(palette[source]));
            if (destination >= 0) palette[destination] = mat4.clone(current);
        } else if (command === 9) {
            const destination = view.getUint8(offset++), count = view.getUint8(offset++);
            current = mat4.create();
            current.fill(0);
            const inverse = assertExists(inverseBindMatrices.get(model));
            for (let i = 0; i < count; i++) {
                const source = view.getUint8(offset++), node = view.getUint8(offset++), weight = view.getUint8(offset++) / 256;
                const weighted = mat4.mul(mat4.create(), assertExists(palette[source]), assertExists(inverse[node]));
                for (let j = 0; j < 16; j++) current[j] += weighted[j] * weight;
            }
            current[15] = 1;
            palette[destination] = mat4.clone(current);
        } else if (command === 11) {
            const scale = option === 1 ? 1 / model.posScale : model.posScale;
            mat4.scale(current, current, [scale, scale, scale]);
        } else if (command === 12 || command === 13) {
            offset += 2;
        } else {
            throw new Error(`Unsupported Black/White model command ${command} in ${model.name}`);
        }
    }
    throw new Error(`Unterminated Black/White model commands in ${model.name}`);
}

export function bakeDraw(draw: ModelDraw, color: Color, alpha: number) {
    const nitroVertexData = readCmds(draw.shape.dlBuffer, { color, alpha });
    const vertices = nitroVertexData.packedVertexBuffer;
    const position = vec3.create(), normal = vec3.create();
    for (let p = 0; p < vertices.length; p += VERTEX_SIZE) {
        const matrix = draw.matrices[vertices[p + 12]] ?? draw.currentMatrix;
        vec3.set(position, vertices[p], vertices[p + 1], vertices[p + 2]);
        vec3.transformMat4(position, position, matrix);
        vertices.set(position, p);

        vec3.set(normal, vertices[p + 9], vertices[p + 10], vertices[p + 11]);
        const nx = normal[0], ny = normal[1], nz = normal[2];
        vec3.set(normal, matrix[0] * nx + matrix[4] * ny + matrix[8] * nz,
            matrix[1] * nx + matrix[5] * ny + matrix[9] * nz,
            matrix[2] * nx + matrix[6] * ny + matrix[10] * nz);
        vec3.normalize(normal, normal);
        vertices.set(normal, p + 9);
        vertices[p + 12] = 0;
    }
    return nitroVertexData;
}
