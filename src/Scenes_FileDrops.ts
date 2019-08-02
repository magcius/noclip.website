
import { SceneDesc, SceneGfx } from "./viewer";
import ArrayBufferSlice from "./ArrayBufferSlice";
import { GfxDevice } from "./gfx/platform/GfxPlatform";
import { readString } from "./util";

import * as Yaz0 from './compression/Yaz0';
import * as CX from './compression/CX';

import * as Grezzo3DS from './oot3d/scenes';
import * as FRES from './fres/scenes';
import * as NNS_G3D from './nns_g3d/scenes';
import * as J3D from './j3d/scenes';
import * as RRES from './rres/scenes';
import { SceneContext, ProgressMeter } from "./SceneBase";

function loadFileAsPromise(file: File, progressMeter: ProgressMeter): Promise<ArrayBufferSlice> {
    const request = new FileReader();
    request.readAsArrayBuffer(file);

    return new Promise<ArrayBufferSlice>((resolve, reject) => {
        request.onload = () => {
            const buffer: ArrayBuffer = request.result as ArrayBuffer;
            const slice = new ArrayBufferSlice(buffer);
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

export class DroppedFileSceneDesc implements SceneDesc {
    public id: string;
    public name: string;

    constructor(public file: File, public files: File[]) {
        this.id = file.name;
        this.name = file.name;
    }

    private decompressArbitraryFile(buffer: ArrayBufferSlice): Promise<ArrayBufferSlice> {
        const magic = readString(buffer, 0x00, 0x04);
        if (magic === 'Yaz0')
            return Yaz0.decompress(buffer);
        else if (magic.charCodeAt(0) === 0x10 || magic.charCodeAt(0) === 0x11)
            return Promise.resolve(CX.decompress(buffer));
        else
            return Promise.resolve(buffer);
    }

    private loadArbitraryFile(device: GfxDevice, buffer: ArrayBufferSlice): Promise<SceneGfx> {
        return this.decompressArbitraryFile(buffer).then((buffer): Promise<SceneGfx> => {
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

    public createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const file = this.file;
        const progressMeter = context.progressMeter;

        if (file.name.endsWith('.zar') || file.name.endsWith('.gar'))
            return loadFileAsPromise(file, progressMeter).then((buffer) => Grezzo3DS.createSceneFromZARBuffer(device, buffer));

        if (file.name.endsWith('.arc') || file.name.endsWith('.carc') || file.name.endsWith('.szs'))
            return loadFileAsPromise(file, progressMeter).then((buffer) => this.loadArbitraryFile(device, buffer));

        if (file.name.endsWith('.brres')) {
            return Promise.all([...this.files].map((f) => loadFileAsPromise(f, progressMeter))).then((buffers) => {
                return RRES.createBasicRRESRendererFromBRRES(device, buffers);
            });
        }

        if (file.name.endsWith('.bfres'))
            return loadFileAsPromise(file, progressMeter).then((buffer) => FRES.createSceneFromFRESBuffer(device, buffer));

        if (file.name.endsWith('.rarc') || file.name.endsWith('.bmd') || file.name.endsWith('.bdl'))
            return loadFileAsPromise(file, progressMeter).then((buffer) => J3D.createMultiSceneFromBuffer(device, buffer));

        if (file.name.endsWith('.nsbmd'))
            return loadFileAsPromise(file, progressMeter).then((buffer) => NNS_G3D.createBasicNSBMDRendererFromNSBMD(device, buffer));

        throw "whoops";
    }
}

