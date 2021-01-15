
import ArrayBufferSlice from "../ArrayBufferSlice";
import { AABB } from "../Geometry";
import { mat4 } from "gl-matrix";
import { assert, readString } from "../util";
import { runDL_F3DEX2, RSPState, RSPOutput } from "./f3dex2";
import { readMatrixRDP } from "../Common/N64/RDP";

// Implementation of the PM64 "shape" format.
// Basically everything in here was reverse engineered by Clover.

export interface MapShapeBinary {
    rootNode: ModelTreeNode;
}

const ramAddrBase = 0x80210000;

const enum InternalType {
    LEAF = 0x02,
    GROUP = 0x05,
    ROOT = 0x07,
    SPECIAL = 0x10,
}

interface ModelTreeNodeBase {
    internalType: InternalType;
    name: string;
    id: number;
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

export const enum PropertyType { INT, FLOAT, STRING }

interface PropertyNumber {
    id: number;
    type: PropertyType.INT | PropertyType.FLOAT;
    value0: number;
    value1: number;
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
    let modelId = 0;
    function readNextModelName(): string {
        const addr = view.getUint32(modelNameTableIdx + 0x00);
        const name = readString(buffer, addr - ramAddrBase, 0x30, true);
        modelNameTableIdx += 0x04;
        return name;
    }

    function parseProperty(propertyOffs: number): Property {
        const id = view.getUint32(propertyOffs + 0x00);
        const value0 = view.getUint32(propertyOffs + 0x04);
        const type = value0 & 0xFF;

        // XXX(jstpierre): Special case this hack for now.
        if (id === 0x5F) {
            const value1 = view.getUint32(propertyOffs + 0x08);
            return { id, type: PropertyType.INT, value0, value1 };
        }

        if (type === PropertyType.INT) {
            const value1 = view.getUint32(propertyOffs + 0x08);
            return { id, type, value0, value1 };
        } else if (type === PropertyType.FLOAT) {
            const value1 = view.getFloat32(propertyOffs + 0x08);
            return { id, type, value0, value1 };
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
        const internalType: InternalType = view.getUint32(nodeOffs + 0x00);
        const displayDataOffs = view.getUint32(nodeOffs + 0x04) - ramAddrBase;
        const numProperties = view.getUint32(nodeOffs + 0x08);
        const propertyTableOffs = view.getUint32(nodeOffs + 0x0C) - ramAddrBase;
        const groupDataAddr = view.getUint32(nodeOffs + 0x10);

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
            if (p.type === PropertyType.FLOAT)
                return p.value1 as number;
            else
                throw "whoops";
        }

        function expectPropertyString(id: number) {
            const p = readNextProperty();
            assert(p.id === id && p.type === PropertyType.STRING);
            if (p.type === PropertyType.STRING)
                return p.value as (string | null);
            else
                throw "whoops";
        }

        const minX = expectPropertyFloat(0x61);
        const minY = expectPropertyFloat(0x61);
        const minZ = expectPropertyFloat(0x61);
        const maxX = expectPropertyFloat(0x61);
        const maxY = expectPropertyFloat(0x61);
        const maxZ = expectPropertyFloat(0x61);

        const bbox = new AABB(minX, minY, minZ, maxX, maxY, maxZ);

        if (internalType === InternalType.LEAF) {
            assert(groupDataAddr === 0x00);

            const texEnvName = expectPropertyString(0x5E);

            // Everything else is misc. properties.
            const properties: Property[] = [];
            while (propertyTableIdx < propertyTableEnd)
                properties.push(readNextProperty());

            const displayListOffs = view.getUint32(displayDataOffs + 0x00) - ramAddrBase;
            assert(view.getUint32(displayDataOffs + 0x04) === 0x00);

            const rspState = new RSPState(buffer, ramAddrBase);
            runDL_F3DEX2(rspState, displayListOffs);
            const rspOutput = rspState.finish();

            const name = readNextModelName();

            return {
                type: 'leaf',
                internalType,
                name,
                id: modelId++,
                bbox,
                texEnvName,
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

            let childrenTableIdx = childrenTableOffs;
            const children: ModelTreeNode[] = [];
            for (let i = 0; i < numChildren; i++) {
                const childNodeOffs = view.getUint32(childrenTableIdx + 0x00) - ramAddrBase;
                children.push(parseModelTreeNode(childNodeOffs));
                childrenTableIdx += 0x04;
            }

            const name = internalType === InternalType.ROOT ? "root" : readNextModelName();

            const modelMatrix = mat4.create();
            if (modelMatrixAddr !== 0) {
                const modelMatrixOffs = modelMatrixAddr - ramAddrBase;
                readMatrixRDP(modelMatrix, view, modelMatrixOffs);
            }

            return {
                type: 'group',
                internalType,
                name,
                id: modelId++,
                bbox,
                children,
                modelMatrix,
            };
        }
    }

    const rootNode = parseModelTreeNode(modelTreeRootOffs + 0x00);
    return { rootNode };
}
