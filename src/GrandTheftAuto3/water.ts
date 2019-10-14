
import { vec3, vec2, quat } from 'gl-matrix';
import { TransparentBlack } from '../Color';
import { ItemPlacement, ItemInstance, ObjectDefinition, INTERIOR_EVERYWHERE } from './item';

export function parseWaterPro(view: DataView, origin: vec3): ItemPlacement {
    const numLevels = view.getInt32(0, true);
    const heights: number[] = [];
    for (let i = 0; i < numLevels; i++) {
        heights.push(view.getFloat32(0x4 + i * 0x4, true));
    }
    const instances: ItemInstance[] = [];
    const offs = 0x4 + 48 * 0x4 + 48 * 0x10 + 64 * 64;
    const size = 32;
    const scale = vec3.fromValues(size, size, 1);
    const rotation = quat.identity(quat.create());
    for (let i = 0; i < 128; i++) {
        for (let j = 0; j < 128; j++) {
            const level = view.getUint8(offs + 128 * i + j);
            if (level & 0x80) continue;
            instances.push({
                modelName: 'water',
                interior: INTERIOR_EVERYWHERE,
                translation: vec3.fromValues(
                    i * size + origin[0] - 2048,
                    j * size + origin[1] - 2048,
                    heights[level]
                ),
                scale, rotation
            });
        }
    }
    return { instances };
}

export const waterDefinition: ObjectDefinition = {
    modelName: 'water',
    txdName: 'particle',
    drawDistance: 1000,
    flags: 0,
    tobj: false,
};

const squarePositions = [
    vec3.fromValues(0,0,0),
    vec3.fromValues(0,1,0),
    vec3.fromValues(1,1,0),
    vec3.fromValues(1,0,0),
];

const squareTexCoords = [
    vec2.fromValues(0,0),
    vec2.fromValues(0,1),
    vec2.fromValues(1,1),
    vec2.fromValues(1,0),
];

export function waterMeshFragData(texture: string) {
    return {
        texName: `particle/${texture}`,
        indices: new Uint16Array([0,1,2,0,2,3]),
        vertices: 4,
        position: (i: number) => squarePositions[i],
        texCoord: (i: number) => squareTexCoords[i],
        color: (i: number) => TransparentBlack,
    };
}
