import * as Viewer from '../viewer';
import { GfxDevice, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { SceneContext } from '../SceneBase';
import { SceneRenderer } from '../kh/render';
import { TexMtxProjection } from '../Common/JSYSTEM/J3D/J3DLoader';
//import * as UI from '../ui';
//import * as BYML from '../byml';


//import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
//import { FakeTextureHolder, TextureHolder } from '../TextureHolder';
//import { mat4, vec3, vec4 } from 'gl-matrix';
import { transparentBlackFullClearRenderPassDescriptor, depthClearRenderPassDescriptor, BasicRenderTarget } from '../gfx/helpers/RenderTargetHelpers';
//import { SceneContext } from '../SceneBase';
//import { GfxRenderHelper } from '../gfx/render/GfxRenderGraph';
//import { executeOnPass, makeSortKey, GfxRendererLayer } from '../gfx/render/GfxRenderer';
//import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
//import ArrayBufferSlice from '../ArrayBufferSlice';
//import { assert, hexzero, assertExists, hexdump } from '../util';
//import { DataFetcher } from '../DataFetcher';
//import { MathConstants } from '../MathHelpers';
//import { CameraController } from '../Camera';

const pathBase = `DonkeyKong64`;

class DK64Renderer implements Viewer.SceneGfx {

    public renderTarget = new BasicRenderTarget();

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const mainPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, depthClearRenderPassDescriptor);
        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void{
        this.renderTarget.destroy(device);
    }
}


class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx>{

        const sceneRenderer = new DK64Renderer();
        return sceneRenderer;
    }

}

// Names taken from Banjo's Backpack.
const id = `dk64`;
const name = "Donkey Kong 64";
const sceneDescs = [
    "Jungle Japes",
    new SceneDesc(`07`, "Jungle Japes"),
    new SceneDesc(`04`, "Mountain"),
    new SceneDesc(`06`, "Minecart"),
    new SceneDesc(`08`, "Army Dillo"),
    new SceneDesc(`0C`, "Shell"),
    new SceneDesc(`0D`, "Lanky's Cave"),
    new SceneDesc(`21`, "Chunkys Cave"),
    new SceneDesc(`25`, "Barrel Blast"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };