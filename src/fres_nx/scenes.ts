
import * as BFRES from './bfres';
import { BRTITextureHolder, FMDLData, FMDLRenderer, BasicFRESRenderer } from './render';

import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxDevice } from '../gfx/platform/GfxPlatform';

export function createSceneFromFRESBuffer(device: GfxDevice, buffer: ArrayBufferSlice): BasicFRESRenderer {
    const fres = BFRES.parse(buffer);
    const textureHolder = new BRTITextureHolder();
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
