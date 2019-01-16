
import * as BFRES from './bfres';
import * as SARC from './sarc';
import * as Yaz0 from '../compression/Yaz0';
import { GX2TextureHolder, BasicFRESRenderer, FMDLData, FMDLRenderer } from './render';

import * as Viewer from '../viewer';

import { readString } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxDevice } from '../gfx/platform/GfxPlatform';

export function createSceneFromFRESBuffer(device: GfxDevice, buffer: ArrayBufferSlice): BasicFRESRenderer {
    const fres = BFRES.parse(buffer);
    const textureHolder = new GX2TextureHolder();
    textureHolder.addFRESTextures(device, fres);

    const sceneRenderer = new BasicFRESRenderer(textureHolder);
    for (let i = 0; i < fres.fmdl.length; i++) {
        const fmdl = fres.fmdl[i];
        const fmdlData = new FMDLData(device, fmdl);
        const renderer = new FMDLRenderer(device, textureHolder, fmdlData);
        sceneRenderer.addFMDLRenderer(device, renderer);
    }
    return sceneRenderer;
}

export function createSceneFromSARCBuffer(device: GfxDevice, buffer: ArrayBufferSlice): Promise<Viewer.SceneGfx> {
    return Promise.resolve(buffer).then((buffer: ArrayBufferSlice) => {
        if (readString(buffer, 0, 4) === 'Yaz0')
            return Yaz0.decompress(buffer);
        else
            return buffer;
    }).then((buffer: ArrayBufferSlice) => {
        const sarc = SARC.parse(buffer);
        const file = sarc.files.find((file) => file.name.endsWith('.bfres'));
        return createSceneFromFRESBuffer(device, file.buffer);
    });
}
