
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
    subdirs: U8Dir[];
    files: U8File[];
    nextNodeIndex: number;
}

type U8Node = U8File | U8Dir;

export class U8Archive {
    public root: U8Dir;

    public findDirParts(parts: string[]): U8Dir {
        let dir = this.root;
        for (const part of parts) {
            dir = dir.subdirs.find((subdir) => subdir.name === part || (part === '*' && dir.subdirs.length === 1));
            if (dir === undefined)
                return null;
        }
        return dir;
    }

    public findDir(path: string): U8Dir {
        return this.findDirParts(path.split('/'));
    }

    public findFile(path: string): U8File {
        const parts = path.split('/');
        const filename = parts.pop();
        const dir = this.findDirParts(parts);
        if (dir === null)
            return null;
        const file = dir.files.find((file) => file.name === filename);
        if (!file)
            return null;
        return file;
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
            const files: U8File[] = [];
            const subdirs: U8Dir[] = [];

            for (let i = nodeIndex + 1; i < nextNodeIndex;) {
                const subNode = readNode(i, nodeIndex);

                if (subNode.kind === 'directory') {
                    subdirs.push(subNode);
                    i = subNode.nextNodeIndex;
                } else {
                    files.push(subNode);
                    i++;
                }
            }

            return { kind: 'directory', name: nodeName, files, subdirs, nextNodeIndex };
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
