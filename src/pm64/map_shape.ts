
import ArrayBufferSlice from "../ArrayBufferSlice";
import { AABB } from "../Geometry";
import { mat4 } from "gl-matrix";
import { assert, readString, hexzero, hexdump } from "../util";
import { runDL_F3DEX2, RSPState, RSPOutput } from "./f3dex2";

// Implementation of the PM64 "shape" format.
// Basically everything in here was reverse engineered by Clover.

export interface MapShapeBinary {
    rootNode: ModelTreeNode;
}

const ramAddrBase = 0x80210000;

interface ModelTreeNodeBase {
    internalType: number;
    name: string;
    bbox: AABB;
}

export interface ModelTreeGroup extends ModelTreeNodeBase {
    type: 'group';
    children: ModelTreeNode[];
    modelMatrix: mat4;
}

export interface ModelTreeLeaf extends ModelTreeNodeBase {
    type: 'leaf';
    texEnvName: string | null;
    properties: Property[];
    rspOutput: RSPOutput;
}

export type ModelTreeNode = ModelTreeGroup | ModelTreeLeaf;

const enum PropertyType { INT, FLOAT, STRING }

interface PropertyNumber {
    id: number;
    type: PropertyType.INT | PropertyType.FLOAT;
    value: number;
}

interface PropertyString {
    id: number;
    type: PropertyType.STRING;
    value: string | null;
}

type Property = PropertyNumber | PropertyString;

export function parse(buffer: ArrayBufferSlice): MapShapeBinary {
    const view = buffer.createDataView();

    const modelTreeRootOffs = view.getUint32(0x00) - ramAddrBase;
    const vertexTableOffs = view.getUint32(0x04) - ramAddrBase;
    const modelNameTableOffs = view.getUint32(0x08) - ramAddrBase;
    const colliderNameTableOffs = view.getUint32(0x0C) - ramAddrBase;
    const zoneNameTableOffs = view.getUint32(0x10) - ramAddrBase;

    let modelNameTableIdx = modelNameTableOffs;
    function readNextModelName(): string {
        const addr = view.getUint32(modelNameTableIdx + 0x04);
        modelNameTableIdx += 0x04;
        return readString(buffer, addr - ramAddrBase, 0x30, true);
    }

    function parseProperty(propertyOffs: number): Property {
        const id = view.getUint32(propertyOffs + 0x00);
        const type = view.getUint32(propertyOffs + 0x04);

        if (type === PropertyType.INT) {
            const value = view.getUint32(propertyOffs + 0x08);
            return { id, type, value };
        } else if (type === PropertyType.FLOAT) {
            const value = view.getFloat32(propertyOffs + 0x08);
            return { id, type, value };
        } else if (type === PropertyType.STRING) {
            const stringAddr = view.getUint32(propertyOffs + 0x08);
            if (stringAddr !== 0) {
                const value = readString(buffer, stringAddr - ramAddrBase, 0x30, true);
                return { id, type, value };
            } else {
                const value: string | null = null;
                return { id, type, value };
            }
        } else {
            throw "whoops";
        }
    }

    // Go through and decode the model tree.
    function parseModelTreeNode(nodeOffs: number): ModelTreeNode {
        const internalType = view.getUint32(nodeOffs + 0x00);
        const displayDataOffs = view.getUint32(nodeOffs + 0x04) - ramAddrBase;
        const numProperties = view.getUint32(nodeOffs + 0x08);
        const propertyTableOffs = view.getUint32(nodeOffs + 0x0C) - ramAddrBase;
        const groupDataAddr = view.getUint32(nodeOffs + 0x10);

        const name = readNextModelName();

        // Parse through properties.

        // Up first is the bbox.
        assert(numProperties >= 6);
        let propertyTableIdx = propertyTableOffs;
        const propertyTableEnd = propertyTableOffs + numProperties * 0x0C;

        function readNextProperty() {
            const p = parseProperty(propertyTableIdx + 0x00);
            propertyTableIdx += 0x0C;
            return p;
        }

        function expectPropertyFloat(id: number) {
            const p = readNextProperty();
            assert(p.id === id && p.type === PropertyType.FLOAT);
            return p.value as number;
        }

        function expectPropertyString(id: number) {
            const p = readNextProperty();
            assert(p.id === id && p.type === PropertyType.STRING);
            return p.value as (string | null);
        }

        const minX = expectPropertyFloat(0x61);
        const minY = expectPropertyFloat(0x61);
        const minZ = expectPropertyFloat(0x61);
        const maxX = expectPropertyFloat(0x61);
        const maxY = expectPropertyFloat(0x61);
        const maxZ = expectPropertyFloat(0x61);

        const bbox = new AABB(minX, minY, minZ, maxX, maxY, maxZ);

        if (internalType === 0x02) {
            // Leaf.
            assert(groupDataAddr === 0x00);

            const textureName = expectPropertyString(0x5E);

            // Everything else is misc. properties.
            const properties: Property[] = [];
            while (propertyTableIdx < propertyTableEnd)
                properties.push(readNextProperty());

            const displayListOffs = view.getUint32(displayDataOffs + 0x00) - ramAddrBase;
            assert(view.getUint32(displayDataOffs + 0x04) === 0x00);

            const rspState = new RSPState();
            rspState.ramAddrBase = ramAddrBase;
            rspState.ramBuffer = buffer;
            runDL_F3DEX2(rspState, displayListOffs);
            rspState.finish();
            const rspOutput = rspState.finish();

            return {
                type: 'leaf',
                internalType,
                name,
                bbox,
                texEnvName: textureName,
                properties,
                rspOutput,
            };
        } else {
            // Other. Basically, a group.
            assert(numProperties === 6 || numProperties === 0x08);

            const groupDataOffs = groupDataAddr - ramAddrBase;

            const modelMatrixAddr = view.getUint32(groupDataOffs + 0x00);
            const numChildren = view.getUint32(groupDataOffs + 0x0C);
            const childrenTableOffs = view.getUint32(groupDataOffs + 0x10) - ramAddrBase;

            const modelMatrix = mat4.create();
            if (modelMatrixAddr !== 0) {
                const modelMatrixOffs = modelMatrixAddr - ramAddrBase;

                // The RDP matrix format is a bit bizarre. High values are separate from low ones.
                modelMatrix[0]  = ((view.getInt16(modelMatrixOffs + 0x00) << 16) | (view.getInt16(modelMatrixOffs + 0x20))) / 0x10000;
                modelMatrix[1]  = ((view.getInt16(modelMatrixOffs + 0x02) << 16) | (view.getInt16(modelMatrixOffs + 0x22))) / 0x10000;
                modelMatrix[2]  = ((view.getInt16(modelMatrixOffs + 0x04) << 16) | (view.getInt16(modelMatrixOffs + 0x24))) / 0x10000;
                modelMatrix[3]  = ((view.getInt16(modelMatrixOffs + 0x06) << 16) | (view.getInt16(modelMatrixOffs + 0x26))) / 0x10000;
                modelMatrix[4]  = ((view.getInt16(modelMatrixOffs + 0x08) << 16) | (view.getInt16(modelMatrixOffs + 0x28))) / 0x10000;
                modelMatrix[5]  = ((view.getInt16(modelMatrixOffs + 0x0A) << 16) | (view.getInt16(modelMatrixOffs + 0x2A))) / 0x10000;
                modelMatrix[6]  = ((view.getInt16(modelMatrixOffs + 0x0C) << 16) | (view.getInt16(modelMatrixOffs + 0x2C))) / 0x10000;
                modelMatrix[7]  = ((view.getInt16(modelMatrixOffs + 0x0E) << 16) | (view.getInt16(modelMatrixOffs + 0x2E))) / 0x10000;
                modelMatrix[8]  = ((view.getInt16(modelMatrixOffs + 0x10) << 16) | (view.getInt16(modelMatrixOffs + 0x30))) / 0x10000;
                modelMatrix[9]  = ((view.getInt16(modelMatrixOffs + 0x12) << 16) | (view.getInt16(modelMatrixOffs + 0x32))) / 0x10000;
                modelMatrix[10] = ((view.getInt16(modelMatrixOffs + 0x14) << 16) | (view.getInt16(modelMatrixOffs + 0x34))) / 0x10000;
                modelMatrix[11] = ((view.getInt16(modelMatrixOffs + 0x16) << 16) | (view.getInt16(modelMatrixOffs + 0x36))) / 0x10000;
                modelMatrix[12] = ((view.getInt16(modelMatrixOffs + 0x18) << 16) | (view.getInt16(modelMatrixOffs + 0x38))) / 0x10000;
                modelMatrix[13] = ((view.getInt16(modelMatrixOffs + 0x1A) << 16) | (view.getInt16(modelMatrixOffs + 0x3A))) / 0x10000;
                modelMatrix[14] = ((view.getInt16(modelMatrixOffs + 0x1C) << 16) | (view.getInt16(modelMatrixOffs + 0x3C))) / 0x10000;
                modelMatrix[15] = ((view.getInt16(modelMatrixOffs + 0x1E) << 16) | (view.getInt16(modelMatrixOffs + 0x3E))) / 0x10000;

                console.log("model matrix found", hexzero(modelMatrixOffs, 4), modelMatrix);
            }

            let childrenTableIdx = childrenTableOffs;
            const children: ModelTreeNode[] = [];
            for (let i = 0; i < numChildren; i++) {
                const childNodeOffs = view.getUint32(childrenTableIdx + 0x00) - ramAddrBase;
                children.push(parseModelTreeNode(childNodeOffs));
                childrenTableIdx += 0x04;
            }

            return {
                type: 'group',
                internalType,
                name,
                bbox,
                children,
                modelMatrix,
            }
        }
    }

    const rootNode = parseModelTreeNode(modelTreeRootOffs + 0x00);
    return { rootNode };
}
