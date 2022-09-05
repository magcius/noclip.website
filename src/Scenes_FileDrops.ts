
import { SceneDesc, SceneGfx } from "./viewer";
import ArrayBufferSlice from "./ArrayBufferSlice";
import { GfxDevice } from "./gfx/platform/GfxPlatform";
import { readString, flatten } from "./util";

import * as Yaz0 from './Common/Compression/Yaz0';
import * as CX from './Common/Compression/CX';

import * as Grezzo3DS from './oot3d/scenes';
import * as NNS_G3D from './nns_g3d/scenes';
import * as J3D from './j3d/scenes';
import * as CTR_H3D from './Common/CTR_H3D/H3D';
import * as RRES from './rres/scenes';
import * as PaperMarioTTYD from './PaperMarioTTYD/Scenes_PaperMarioTTYD';
import * as JPAExplorer from './InteractiveExamples/JPAExplorer';
import * as SourceFileDrops from './SourceEngine/Scenes_FileDrops';
import * as SuperMonkeyBall from './SuperMonkeyBall/Scenes_SuperMonkeyBall';
import { SceneContext } from "./SceneBase";
import { DataFetcher, NamedArrayBufferSlice } from "./DataFetcher";

function loadFileAsPromise(file: File, dataFetcher: DataFetcher): Promise<NamedArrayBufferSlice> {
    const progressMeter = dataFetcher.progressMeter;

    const request = new FileReader();
    request.readAsArrayBuffer(file);

    return new Promise<NamedArrayBufferSlice>((resolve, reject) => {
        request.onload = () => {
            const buffer: ArrayBuffer = request.result as ArrayBuffer;
            const slice = new ArrayBufferSlice(buffer) as NamedArrayBufferSlice;
            slice.name = file.name;
            resolve(slice);
        };
        request.onerror = () => {
            reject();
        };
        request.onprogress = (e) => {
            if (e.lengthComputable)
                progressMeter.setProgress(e.loaded / e.total);
        };
    });
}

export function decompressArbitraryFile(buffer: ArrayBufferSlice): Promise<ArrayBufferSlice> {
    const magic = readString(buffer, 0x00, 0x04);
    if (magic === 'Yaz0')
        return Yaz0.decompress(buffer);
    else if (magic.charCodeAt(0) === 0x10 || magic.charCodeAt(0) === 0x11)
        return Promise.resolve(CX.decompress(buffer));
    else
        return Promise.resolve(buffer);
}

async function loadArbitraryFile(context: SceneContext, buffer: ArrayBufferSlice): Promise<SceneGfx> {
    const device = context.device;

    buffer = await decompressArbitraryFile(buffer);
    const magic = readString(buffer, 0x00, 0x04);

    if (magic === 'RARC' || magic === 'CRAR' || magic === 'J3D2')
        return J3D.createSceneFromBuffer(context, buffer);

    if (magic === '\x55\xAA\x38\x2D') // U8
        return RRES.createSceneFromU8Buffer(context, buffer);

    if (magic === 'bres')
        return RRES.createBasicRRESRendererFromBRRES(device, [buffer]);

    throw "whoops";
}

export async function createSceneFromFiles(context: SceneContext, buffers: NamedArrayBufferSlice[]): Promise<SceneGfx> {
    const device = context.device;

    buffers.sort((a, b) => a.name.localeCompare(b.name));

    const buffer = buffers[0];

    if (buffer.name.endsWith('.zar') || buffer.name.endsWith('.gar') || buffer.name.endsWith('.gar.lzs'))
        return Grezzo3DS.createSceneFromZARBuffer(device, buffer);

    if (buffer.name.endsWith('.arc') || buffer.name.endsWith('.carc') || buffer.name.endsWith('.szs'))
        return loadArbitraryFile(context, buffer);

    if (buffer.name.endsWith('.jpc'))
        return JPAExplorer.createRendererFromBuffers(context, [buffer]);

    if (buffers.every((b) => b.name.endsWith('.jpa')))
        return JPAExplorer.createRendererFromBuffers(context, buffers);

    if (buffers.some((b) => b.name.endsWith('.brres')))
        return RRES.createBasicRRESRendererFromBRRES(device, buffers);

    if (buffer.name.endsWith('.rarc') || buffer.name.endsWith('.bmd') || buffer.name.endsWith('.bdl'))
        return J3D.createSceneFromBuffer(context, buffer);

    if (buffer.name.endsWith('.nsbmd'))
        return NNS_G3D.createBasicNSBMDRendererFromNSBMD(device, buffer);

    if (buffers.length === 2 && buffers[0].name === 'd' && buffers[1].name === 't')
        return PaperMarioTTYD.createWorldRendererFromBuffers(device, buffers[0], buffers[1]);

    if (buffer.name.endsWith('.bch'))
        CTR_H3D.parse(buffer);

    if (buffer.name.endsWith('.bsp') || buffer.name.endsWith('.gma'))
        return SourceFileDrops.createFileDropsScene(context, buffer); 

    const superMonkeyBallRenderer = SuperMonkeyBall.createSceneFromNamedBuffers(context, buffers);
    if (superMonkeyBallRenderer !== null) {
        return superMonkeyBallRenderer;
    }

    throw "whoops";
}

export class DroppedFileSceneDesc implements SceneDesc {
    public id: string;
    public name: string;

    constructor(public files: File[]) {
        // Pick some file as the ID.
        const file = files[0];

        this.id = file.name;
        this.name = file.name;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const buffers = await Promise.all([...this.files].map((f) => loadFileAsPromise(f, dataFetcher)));
        return createSceneFromFiles(context, buffers);
    }
}

async function readAllDirEntries(reader: DirectoryReader): Promise<Entry[]> {
    function readDirEntries(reader: DirectoryReader): Promise<Entry[]> {
        return new Promise((resolve, reject) => {
            return reader.readEntries(resolve, reject);
        })
    }

    const entries: Entry[] = [];
    // We need to keep calling readDirEntries until it returns nothing.
    while (true) {
        const result = await readDirEntries(reader);
        if (result.length === 0)
            break;
        for (let i = 0; i < result.length; i++)
            entries.push(result[i]);
    }

    return entries;
}

export interface FileWithPath extends File {
    path: string;
}

async function traverseFileSystemEntry(entry: Entry, path: string = ''): Promise<FileWithPath[]> {
    if (entry.isDirectory) {
        const dirEntry = entry as DirectoryEntry;
        const reader = dirEntry.createReader();
        const entries = await readAllDirEntries(reader);

        return traverseFileSystemEntryTree(entries, `${path}/${entry.name}`);
    } else if (entry.isFile) {
        const fileEntry = entry as FileEntry;

        return new Promise((resolve, reject) => {
            fileEntry.file((file) => {
                // Inject our own path.
                const fileWithPath = file as FileWithPath;
                fileWithPath.path = path;
                resolve([fileWithPath]);
            }, (error) => {
                reject(error);
            });
        });
    } else {
        throw "whoops";
    }
}

async function traverseFileSystemEntryTree(entries: Entry[], path: string): Promise<FileWithPath[]> {
    const files = await Promise.all(entries.map((entry) => {
        return traverseFileSystemEntry(entry, path);
    }));

    return flatten(files);
}

export async function traverseFileSystemDataTransfer(dataTransfer: DataTransfer): Promise<FileWithPath[]> {
    const items: DataTransferItem[] = [].slice.call(dataTransfer.items);

    if (items.length === 0)
        return [];

    const promises: Promise<FileWithPath[]>[] = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item === null)
            continue;
        const entry = item.webkitGetAsEntry() as Entry | null;
        if (entry === null)
            continue;
        promises.push(traverseFileSystemEntry(entry));
    }

    return flatten(await Promise.all(promises));
}
