
// Nintendo RARC file format.

import ArrayBufferSlice from 'ArrayBufferSlice';
import { assert, readString } from 'util';

export interface RARCFile {
    name: string;
    buffer: ArrayBufferSlice;
}

export interface RARCDir {
    name: string;
    type: string;
    files: RARCFile[];
    subdirs: RARCDir[];
}

export class RARC {
    // All the files in a flat list.
    public files: RARCFile[];
    // Root directory.
    public root: RARCDir;

    public findDirParts(parts: string[]): RARCDir {
        let dir = this.root;
        for (const part of parts) {
            dir = dir.subdirs.find((subdir) => subdir.name === part);
            if (dir === undefined)
                return null;
        }
        return dir;
    }

    public findDir(path: string): RARCDir {
        return this.findDirParts(path.split('/'));
    }

    public findFile(path: string): RARCFile {
        const parts = path.split('/');
        const filename = parts.pop();
        const dir = this.findDirParts(parts);
        if (dir === null)
            return null;
        return dir.files.find((file) => file.name === filename);
    }
}

// Used while parsing
interface DirEntry {
    name: string;
    type: string;
    files: RARCFile[];
    subdirIndexes: number[];
}

export function parse(buffer: ArrayBufferSlice): RARC {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'RARC');
    const size = view.getUint32(0x04);
    const dataOffs = view.getUint32(0x0C) + 0x20;
    const dirCount = view.getUint32(0x20);
    const dirTableOffs = view.getUint32(0x24) + 0x20;
    const fileEntryCount = view.getUint32(0x28);
    const fileEntryTableOffs = view.getUint32(0x2C) + 0x20;
    const strTableOffs = view.getUint32(0x34) + 0x20;

    let dirTableIdx = dirTableOffs;
    const dirEntries: DirEntry[] = [];
    const allFiles: RARCFile[] = [];
    for (let i = 0; i < dirCount; i++) {
        const type = readString(buffer, dirTableIdx + 0x00, 0x04, false);
        const nameOffs = view.getUint32(dirTableIdx + 0x04);
        const name = readString(buffer, strTableOffs + nameOffs, -1, true);
        const nameHash = view.getUint16(dirTableIdx + 0x08);
        const fileEntryCount = view.getUint16(dirTableIdx + 0x0A);
        const fileEntryFirstIndex = view.getUint32(dirTableIdx + 0x0C);

        const files: RARCFile[] = [];
        const subdirIndexes = [];

        // Go through and parse the file table.
        let fileEntryIdx = fileEntryTableOffs + (fileEntryFirstIndex * 0x14);
        for (let i = 0; i < fileEntryCount; i++) {
            const id = view.getUint16(fileEntryIdx + 0x00);
            const nameHash = view.getUint16(fileEntryIdx + 0x02);
            const flags = view.getUint8(fileEntryIdx + 0x04);
            const nameOffs = view.getUint16(fileEntryIdx + 0x06);
            const name = readString(buffer, strTableOffs + nameOffs, -1, true);

            const entryDataOffs = view.getUint32(fileEntryIdx + 0x08);
            const entryDataSize = view.getUint32(fileEntryIdx + 0x0C);
            fileEntryIdx += 0x14;

            if (name === '.' || name === '..')
                continue;

            const isDirectory = !!(flags & 0x02);
            if (isDirectory) {
                const subdirEntryIndex = entryDataOffs;
                subdirIndexes.push(subdirEntryIndex);
            } else {
                const offs = dataOffs + entryDataOffs;
                const fileBuffer = buffer.slice(offs, offs + entryDataSize);
                const file: RARCFile = { name, buffer: fileBuffer };
                files.push(file);
                allFiles.push(file);
            }
        }

        dirEntries.push({ name, type, files, subdirIndexes });
        dirTableIdx += 0x10;
    }

    const dirs: RARCDir[] = [];
    function translateDirEntry(i: number): RARCDir {
        if (dirs[i] !== undefined)
            return dirs[i];

        const dirEntry = dirEntries[i];
        const name = dirEntry.name, type = dirEntry.type, files = dirEntry.files;
        const subdirs = dirEntry.subdirIndexes.map((i) => translateDirEntry(i));
        const dir: RARCDir = { name, type, files, subdirs };
        dirs[i] = dir;
        return dir;
    }

    const root = translateDirEntry(0);
    assert(root.type === 'ROOT');

    const rarc = new RARC();
    rarc.files = allFiles;
    rarc.root = root;
    return rarc;
}
