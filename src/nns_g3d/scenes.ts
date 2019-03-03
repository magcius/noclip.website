
import { BasicRendererHelper } from "../oot3d/render";
import { MDL0Renderer } from "./render";
import { GfxDevice, GfxHostAccessPass } from "../gfx/platform/GfxPlatform";
import { FakeTextureHolder } from "../TextureHolder";
import { ViewerRenderInput } from "../viewer";
import ArrayBufferSlice from "../ArrayBufferSlice";

import * as NSBMD from './nsbmd';

export class BasicNSBMDRenderer extends BasicRendererHelper {
    public mdl0Renderers: MDL0Renderer[] = [];

    constructor(public textureHolder: FakeTextureHolder) {
        super();
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        for (let i = 0; i < this.mdl0Renderers.length; i++)
            this.mdl0Renderers[i].prepareToRender(hostAccessPass, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        for (let i = 0; i < this.mdl0Renderers.length; i++)
            this.mdl0Renderers[i].destroy(device);
    }
}

export function createBasicNSBMDRendererFromNSBMD(device: GfxDevice, buffer: ArrayBufferSlice) {
    const textureHolder = new FakeTextureHolder([]);
    const renderer = new BasicNSBMDRenderer(textureHolder);

    const bmd = NSBMD.parse(buffer);
    for (let i = 0; i < bmd.models.length; i++) {
        const mdl0 = bmd.models[0];
        const mdl0Renderer = new MDL0Renderer(device, mdl0, bmd.tex0);
        for (let j = 0; j < mdl0Renderer.viewerTextures.length; j++)
            textureHolder.viewerTextures.push(mdl0Renderer.viewerTextures[j]);

        mdl0Renderer.addToViewRenderer(device, renderer.viewRenderer);
        renderer.mdl0Renderers.push(mdl0Renderer);
    }

    return renderer;
}
