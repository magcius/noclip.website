
import ArrayBufferSlice from "ArrayBufferSlice";
import { assert, readString, align } from "util";
import { Endianness } from "endian";

export const enum FileType {
    BYML,
    CRG1, // Jasper's BYML variant with extensions.
}

interface FileDescription {
    magic: string;
    allowedNodeTypes: NodeType[];
}

const fileDescriptions: { [key: number]: FileDescription } = {
    [FileType.BYML]: { magic: 'BY\0\x02', allowedNodeTypes: [ NodeType.STRING, NodeType.ARRAY, NodeType.DICT, NodeType.STRING_TABLE, NodeType.BOOL, NodeType.INT, NodeType.SHORT, NodeType.FLOAT ] },
    [FileType.CRG1]: { magic: 'CRG1',     allowedNodeTypes: [ NodeType.STRING, NodeType.ARRAY, NodeType.DICT, NodeType.STRING_TABLE, NodeType.BOOL, NodeType.INT, NodeType.SHORT, NodeType.FLOAT, NodeType.FLOAT_ARRAY, NodeType.BINARY_DATA, NodeType.NULL ] },
}

const enum NodeType {
    STRING       = 0xA0,
    ARRAY        = 0xC0,
    DICT         = 0xC1,
    STRING_TABLE = 0xC2,
    BINARY_DATA  = 0xCB, // CRG1 extension.
    BOOL         = 0xD0,
    INT          = 0xD1,
    FLOAT        = 0xD2,
    SHORT        = 0xD3,
    NULL         = 0xDF, // CRG1 extension. Probably exists in original.
    FLOAT_ARRAY  = 0xE2, // CRG1 extension.
}

export type StringTable = string[];
export type ComplexNode = NodeDict | NodeArray | StringTable | ArrayBufferSlice | Float32Array;
export type SimpleNode = number | string | boolean | null;
export type Node = ComplexNode | SimpleNode;

export interface NodeDict { [key: string]: Node; }
export interface NodeArray extends Array<Node> {}

interface ParseContext {
    fileType: FileType;
    strKeyTable: StringTable;
    strValueTable: StringTable;
}

function parseStringTable(buffer: ArrayBufferSlice, offs: number): StringTable {
    const view = buffer.createDataView();
    const header = view.getUint32(offs + 0x00);
    const nodeType: NodeType = header >>> 24;
    const numValues: number = header & 0x00FFFFFF;
    assert(nodeType === NodeType.STRING_TABLE);

    let stringTableIdx: number = offs + 0x04;
    const strings: StringTable = [];
    for (let i = 0; i < numValues; i++) {
        const strOffs = offs + view.getUint32(stringTableIdx);
        strings.push(readString(buffer, strOffs, -1, true));
        stringTableIdx += 0x04;
    }
    return strings;
}

function parseDict(context: ParseContext, buffer: ArrayBufferSlice, offs: number): NodeDict {
    const view = buffer.createDataView();
    const header = view.getUint32(offs + 0x00);
    const nodeType: NodeType = header >>> 24;
    const numValues: number = header & 0x00FFFFFF;
    assert(nodeType === NodeType.DICT);

    const result: NodeDict = {};
    let dictIdx = offs + 0x04;
    for (let i = 0; i < numValues; i++) {
        const entryHeader: number = view.getUint32(dictIdx + 0x00);
        const entryStrKeyIdx: number = entryHeader >>> 8;
        const entryKey = context.strKeyTable[entryStrKeyIdx];
        const entryNodeType: NodeType = entryHeader & 0xFF;
        const entryValue = parseNode(context, buffer, entryNodeType, dictIdx + 0x04);
        result[entryKey] = entryValue;
        dictIdx += 0x08;
    }
    return result;
}

function parseArray(context: ParseContext, buffer: ArrayBufferSlice, offs: number): NodeArray {
    const view = buffer.createDataView();
    const header = view.getUint32(offs + 0x00);
    const nodeType: NodeType = header >>> 24;
    const numValues: number = header & 0x00FFFFFF;
    assert(nodeType === NodeType.ARRAY);

    const result: NodeArray = [];
    let entryTypeIdx = offs + 0x04;
    let entryOffsIdx = align(entryTypeIdx + numValues, 4);
    for (let i = 0; i < numValues; i++) {
        const entryNodeType: NodeType = view.getUint8(entryTypeIdx);
        result.push(parseNode(context, buffer, entryNodeType, entryOffsIdx));
        entryTypeIdx++;
        entryOffsIdx += 0x04;
    }
    return result;
}

function parseComplexNode(context: ParseContext, buffer: ArrayBufferSlice, expectedNodeType: NodeType, offs: number): ComplexNode {
    const view = buffer.createDataView();
    const header = view.getUint32(offs + 0x00);
    const nodeType: NodeType = header >>> 24;
    const numValues: number = header & 0x00FFFFFF;
    assert(expectedNodeType === nodeType);
    switch(nodeType) {
    case NodeType.DICT:
        return parseDict(context, buffer, offs);
    case NodeType.ARRAY:
        return parseArray(context, buffer, offs);
    case NodeType.STRING_TABLE:
        return parseStringTable(buffer, offs);
    case NodeType.BINARY_DATA:
        return buffer.subarray(offs + 0x04, numValues);
    case NodeType.FLOAT_ARRAY:
        return buffer.createTypedArray(Float32Array, offs + 0x04, numValues, Endianness.BIG_ENDIAN);
    default:
        throw new Error("whoops");
    }
}

function validateNodeType(context: ParseContext, nodeType: NodeType) {
    assert(fileDescriptions[context.fileType].allowedNodeTypes.includes(nodeType));
}

function parseNode(context: ParseContext, buffer: ArrayBufferSlice, nodeType: NodeType, offs: number): Node {
    const view = buffer.createDataView();
    validateNodeType(context, nodeType);

    switch (nodeType) {
    case NodeType.ARRAY:
    case NodeType.DICT:
    case NodeType.STRING_TABLE:
    case NodeType.BINARY_DATA:
    case NodeType.FLOAT_ARRAY: {
        const complexOffs = view.getUint32(offs);
        return parseComplexNode(context, buffer, nodeType, complexOffs);
    }
    case NodeType.STRING: {
        const idx = view.getUint32(offs);
        return context.strValueTable[idx];
    }
    case NodeType.BOOL: {
        const value = view.getUint32(offs);
        assert(value === 0 || value === 1);
        return !!value;
    }
    case NodeType.INT:
    case NodeType.SHORT: {
        const value = view.getUint32(offs);
        return value;
    }
    case NodeType.FLOAT: {
        const value = view.getFloat32(offs);
        return value;
    }
    case NodeType.NULL: {
        return null;
    }
    }
}

export function parse(buffer: ArrayBufferSlice, fileType: FileType = FileType.BYML): NodeDict {
    const magic = fileDescriptions[fileType].magic;
    assert(readString(buffer, 0x00, 0x04) == magic);
    const view = buffer.createDataView();

    const strKeyTable = parseStringTable(buffer, view.getUint32(0x04));
    const strValueTable = parseStringTable(buffer, view.getUint32(0x08));
    const context: ParseContext = { fileType, strKeyTable, strValueTable };
    const node = parseComplexNode(context, buffer, NodeType.DICT, view.getUint32(0x0C));
    return <NodeDict> node;
}
