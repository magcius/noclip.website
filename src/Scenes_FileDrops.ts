
import { SceneDesc, SceneGfx } from "./viewer";
import ArrayBufferSlice from "./ArrayBufferSlice";
import { GfxDevice } from "./gfx/platform/GfxPlatform";
import { readString } from "./util";

import * as Yaz0 from './compression/Yaz0';
import * as CX from './compression/CX';

import * as Grezzo3DS from './oot3d/scenes';
import * as NNS_G3D from './nns_g3d/scenes';
import * as J3D from './j3d/scenes';
import * as CTR_H3D from './Common/CTR_H3D/H3D';
import * as RRES from './rres/scenes';
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

function loadArbitraryFile(device: GfxDevice, buffer: ArrayBufferSlice): Promise<SceneGfx> {
    return decompressArbitraryFile(buffer).then((buffer): Promise<SceneGfx> => {
        const magic = readString(buffer, 0x00, 0x04);

        if (magic === 'RARC' || magic === 'J3D2')
            return J3D.createMultiSceneFromBuffer(device, buffer);

        if (magic === '\x55\xAA\x38\x2D') // U8
            return Promise.resolve(RRES.createSceneFromU8Buffer(device, buffer));

        if (magic === 'bres')
            return Promise.resolve(RRES.createBasicRRESRendererFromBRRES(device, [buffer]));

        throw "whoops";
    });
}

export async function createSceneFromFiles(device: GfxDevice, buffers: NamedArrayBufferSlice[]): Promise<SceneGfx> {
    const buffer = buffers[0];

    if (buffer.name.endsWith('.zar') || buffer.name.endsWith('.gar'))
        return Grezzo3DS.createSceneFromZARBuffer(device, buffer);

    if (buffer.name.endsWith('.arc') || buffer.name.endsWith('.carc') || buffer.name.endsWith('.szs'))
        return loadArbitraryFile(device, buffer);

    if (buffer.name.endsWith('.brres'))
        return RRES.createBasicRRESRendererFromBRRES(device, buffers);

    if (buffer.name.endsWith('.rarc') || buffer.name.endsWith('.bmd') || buffer.name.endsWith('.bdl'))
        return J3D.createMultiSceneFromBuffer(device, buffer);

    if (buffer.name.endsWith('.nsbmd'))
        return NNS_G3D.createBasicNSBMDRendererFromNSBMD(device, buffer);

    if (buffer.name.endsWith('.bch'))
        CTR_H3D.parse(buffer);

    throw "whoops";
}

export class DroppedFileSceneDesc implements SceneDesc {
    public id: string;
    public name: string;

    constructor(public file: File, public files: File[]) {
        this.id = file.name;
        this.name = file.name;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const buffers = await Promise.all([...this.files].map((f) => loadFileAsPromise(f, dataFetcher)));
        return createSceneFromFiles(device, buffers);
    }
}
