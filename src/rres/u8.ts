
// Nintendo "U8" filesystem archives.
// http://wiki.tockdom.com/wiki/U8_(File_Format)
// http://wiibrew.org/wiki/U8_archive

import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString, assert } from "../util";

export interface U8File {
    kind: 'file';
    name: string;
    buffer: ArrayBufferSlice;
}

export interface U8Dir {
    kind: 'directory';
    name: string;
    childNodes: U8Node[];
    subdirs: U8Dir[];
    files: U8File[];
    nextNodeIndex: number;
}

type U8Node = U8File | U8Dir;

function findChildNodeByPart(dir: U8Dir, part: string): U8Node | null {
    if (part === '*' && dir.childNodes.length === 1)
        return dir.childNodes[0];

    if (part === '.')
        return dir;

    for (let i = 0; i < dir.childNodes.length; i++) {
        const child = dir.childNodes[i];
        if (child.name === part)
            return child;

        if (child.kind === 'directory' && child.name === '.') {
            const sub = findChildNodeByPart(child, part);
            if (sub !== null)
                return sub;
        }
    }

    return null;
}

function findChildNodeByParts(dir: U8Dir, parts: string[]): U8Node | null {
    for (let i = 0; i < parts.length; i++) {
        const child = findChildNodeByPart(dir, parts[i]);
        if (child === null)
            return null;

        if (child.kind === 'file') {
            if (i === parts.length - 1)
                return child;
            else
                return null;
        }

        dir = child;
    }

    return dir;
}

export class U8Archive {
    public root: U8Dir;

    public findDir(path: string): U8Dir | null {
        const child = findChildNodeByParts(this.root, path.split('/'));
        if (child !== null && child.kind === 'directory')
            return child;
        else
            return null;
    }

    public findFile(path: string): U8File | null {
        const child = findChildNodeByParts(this.root, path.split('/'));
        if (child !== null && child.kind === 'file')
            return child;
        else
            return null;
    }

    public findFileData(path: string): ArrayBufferSlice | null {
        const file = this.findFile(path);
        if (file !== null)
            return file.buffer;
        else
            return null;
    }
}

export function parse(buffer: ArrayBufferSlice): U8Archive {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === '\x55\xAA\x38\x2D');
    const tocOffs = view.getUint32(0x04, false);
    const headerSize = view.getUint32(0x08, false);

    // Pointer to data -- unused.
    const dataOffs = view.getUint32(0x0C, false);

    // Read root node to find string table.
    enum NodeType {
        File = 0x00,
        Directory = 0x01,
    }

    const rootNodeType: NodeType = view.getUint8(tocOffs + 0x00);
    assert(rootNodeType === NodeType.Directory);
    const rootNodeChildCount = view.getUint32(tocOffs + 0x08, false);
    const stringTableOffs = tocOffs + (rootNodeChildCount * 0x0C);

    function readNode(nodeIndex: number, parentIndex: number): U8Node {
        const nodeOffs: number = tocOffs + (nodeIndex * 0x0C);
        const nodeType: NodeType = view.getUint8(nodeOffs + 0x00);
        const nodeNameOffs = view.getUint32(nodeOffs + 0x00) & 0x00FFFFFF;
        const nodeName = readString(buffer, stringTableOffs + nodeNameOffs);

        if (nodeType === NodeType.Directory) {
            const nodeParentIndex = view.getUint32(nodeOffs + 0x04, false);
            assert(nodeParentIndex === parentIndex);

            // The index of the first node *not* in this directory.
            const nextNodeIndex = view.getUint32(nodeOffs + 0x08, false);

            // Recurse.
            const childNodes: U8Node[] = [];
            const files: U8File[] = [];
            const subdirs: U8Dir[] = [];

            for (let i = nodeIndex + 1; i < nextNodeIndex;) {
                const subNode = readNode(i, nodeIndex);
                childNodes.push(subNode);

                if (subNode.kind === 'directory') {
                    subdirs.push(subNode);
                    i = subNode.nextNodeIndex;
                } else {
                    files.push(subNode);
                    i++;
                }
            }

            return { kind: 'directory', name: nodeName, childNodes, subdirs, files, nextNodeIndex };
        } else if (nodeType === NodeType.File) {
            const nodeDataBegin = view.getUint32(nodeOffs + 0x04, false);
            const nodeDataSize = view.getUint32(nodeOffs + 0x08, false);
            const nodeBuffer = buffer.subarray(nodeDataBegin, nodeDataSize);
            return { kind: 'file', name: nodeName, buffer: nodeBuffer };
        } else {
            throw "whoops";
        }
    }

    // Root node (0) has parent index 0...
    const rootNode: U8Dir = readNode(0, 0) as U8Dir;
    assert(rootNode.kind === 'directory');

    const archive = new U8Archive();
    archive.root = rootNode;
    return archive;
}
