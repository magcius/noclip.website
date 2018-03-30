
import { assert, readString } from 'util';
import ArrayBufferSlice from 'ArrayBufferSlice';

interface MaterialAnimation {
    property: 'scale' | 'rotation' | 'x' | 'y';
    values: Float32Array;
}

interface Material {
    name: string;
    animations: MaterialAnimation[];
}

export interface Level {
    id: string;
    attributes: Map<string, string>;
    materials: Material[];
}

export interface CRG0 {
    levels: Level[];
}

export function parse(buffer: ArrayBufferSlice): CRG0 {
    const view = buffer.createDataView();

    assert(readString(buffer, 0, 0x04) === 'CRG0');

    const levelTableCount = view.getUint32(0x08, false);
    const levelTableOffs = view.getUint32(0x0C, false);
    const levels: Level[] = [];

    let levelTableIdx = levelTableOffs;
    for (let i = 0; i < levelTableCount; i++) {
        assert(view.getUint8(levelTableIdx) === 0x4d);
        const levelId = view.getUint8(levelTableIdx + 0x01);
        const levelAttributesCount = view.getUint8(levelTableIdx + 0x02);
        const levelMaterialsCount = view.getUint8(levelTableIdx + 0x03);
        levelTableIdx += 0x04;

        const levelAttributes = new Map<string, string>();
        for (let j = 0; j < levelAttributesCount; j++) {
            const keyOffs = view.getUint32(levelTableIdx + 0x00, false);
            const valueOffs = view.getUint32(levelTableIdx + 0x04, false);
            const key = readString(buffer, keyOffs, 0x20);
            const value = readString(buffer, valueOffs, 0x20);
            levelTableIdx += 0x08;
            levelAttributes.set(key, value);
        }

        const materials: Material[] = [];
        for (let j = 0; j < levelMaterialsCount; j++) {
            const materialNameOffs = view.getUint32(levelTableIdx + 0x00, false);
            const materialName = readString(buffer, materialNameOffs, 0x20);
            levelTableIdx += 0x04;
            const scaleOffs = view.getUint32(levelTableIdx + 0x00, false);
            const scaleCount = view.getUint32(levelTableIdx + 0x04, false);
            const scaleValues = buffer.createTypedArray(Float32Array, scaleOffs, scaleCount);
            levelTableIdx += 0x08;
            const rotationOffs = view.getUint32(levelTableIdx + 0x00, false);
            const rotationCount = view.getUint32(levelTableIdx + 0x04, false);
            const rotationValues = buffer.createTypedArray(Float32Array, rotationOffs, rotationCount);
            levelTableIdx += 0x08;
            const translationXOffs = view.getUint32(levelTableIdx + 0x00, false);
            const translationXCount = view.getUint32(levelTableIdx + 0x04, false);
            const translationXValues = buffer.createTypedArray(Float32Array, translationXOffs, translationXCount);
            levelTableIdx += 0x08;
            const translationYOffs = view.getUint32(levelTableIdx + 0x00, false);
            const translationYCount = view.getUint32(levelTableIdx + 0x04, false);
            const translationYValues = buffer.createTypedArray(Float32Array, translationYOffs, translationYCount);
            levelTableIdx += 0x08;

            const animations: MaterialAnimation[] = [
                { property: 'scale', values: scaleValues },
                { property: 'rotation', values: rotationValues },
                { property: 'x', values: translationXValues },
                { property: 'x', values: translationYValues },
            ];

            materials.push({ name: materialName, animations });
        }

        const id = '' + levelId;
        levels.push({ id: id, attributes: levelAttributes, materials });
    }

    return { levels };
}
