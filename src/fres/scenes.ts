
import * as BFRES from './bfres';
import * as SARC from './sarc';
import * as Yaz0 from '../compression/Yaz0';
import { ModelRenderer, GX2TextureHolder } from './render';
import * as GX2Texture from './gx2_texture';

import * as Viewer from '../viewer';

import { RenderState } from '../render';
import { readString } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';

class FRESRenderer implements Viewer.MainScene {
    constructor(public textureHolder: GX2TextureHolder, public scenes: ModelRenderer[]) {
    }

    public render(state: RenderState) {
        state.setClipPlanes(0.2, 500000);
        this.scenes.forEach((s) => {
            s.render(state);
        });
    }

    public destroy(gl: WebGL2RenderingContext) {
        GX2Texture.deswizzler.terminate();

        this.scenes.forEach((s) => s.destroy(gl));
    }
}

export function createSceneFromFRESBuffer(gl: WebGL2RenderingContext, buffer: ArrayBufferSlice): FRESRenderer {
    const fres = BFRES.parse(buffer);
    const textureHolder = new GX2TextureHolder();
    textureHolder.addFRESTextures(gl, fres);
    let scenes = fres.fmdl.map((s) => new ModelRenderer(gl, textureHolder, fres, s.fmdl));
    return new FRESRenderer(textureHolder, scenes);
}

export function createSceneFromSARCBuffer(gl: WebGL2RenderingContext, buffer: ArrayBufferSlice): Promise<Viewer.MainScene> {
    return Promise.resolve(buffer).then((buffer: ArrayBufferSlice) => {
        if (readString(buffer, 0, 4) === 'Yaz0')
            return Yaz0.decompress(buffer);
        else
            return buffer;
    }).then((buffer: ArrayBufferSlice) => {
        const sarc = SARC.parse(buffer);
        const file = sarc.files.find((file) => file.name.endsWith('.bfres'));
        return createSceneFromFRESBuffer(gl, file.buffer);
    });
}
