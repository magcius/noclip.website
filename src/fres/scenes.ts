
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
    public textures: Viewer.Texture[];

    constructor(private textureHolder: GX2TextureHolder, public mainScene: Viewer.Scene) {
        this.textures = textureHolder.viewerTextures;
    }

    public render(state: RenderState) {
        const gl = state.gl;
        state.setClipPlanes(0.2, 500000);
        if (this.mainScene) {
            this.mainScene.render(state);
        }
    }

    public destroy(gl: WebGL2RenderingContext) {
        GX2Texture.deswizzler.terminate();

        if (this.mainScene)
            this.mainScene.destroy(gl);
    }
}

export function createSceneFromFRESBuffer(gl: WebGL2RenderingContext, buffer: ArrayBufferSlice): FRESRenderer {
    const fres = BFRES.parse(buffer);
    const textureHolder = new GX2TextureHolder();
    return new FRESRenderer(textureHolder, new ModelRenderer(gl, textureHolder, fres, fres.fmdl[0].fmdl));
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
