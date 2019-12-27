// Amusement Vision Stages
// currentrly for F-ZERO GX
//import { GMA } from './gma';

import * as avlz from './avlz';
import { GMARenderer } from './render';

import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import * as Viewer from '../viewer';
import { SceneContext } from '../SceneBase';
import { GfxRenderDynamicUniformBuffer } from '../gfx/render/GfxRenderDynamicUniformBuffer';
import { BasicRenderTarget, depthClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { FakeTextureHolder } from '../TextureHolder';

export class AmusementVisionRenderer implements Viewer.SceneGfx {
    public renderTarget = new BasicRenderTarget();
    uniformBuffer: GfxRenderDynamicUniformBuffer;

    constructor(device: GfxDevice, public textureHolder: FakeTextureHolder) {
        this.uniformBuffer = new GfxRenderDynamicUniformBuffer(device);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();

        const mainPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, depthClearRenderPassDescriptor);

        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
    }
}
class AmusementVisionDesc implements Viewer.SceneDesc {
    constructor(public gameCompressionMethod: avlz.CompressionMethod, public id: string, public backGroundName: string, public name: string) { }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const textureHolder = new FakeTextureHolder([]);
        const dataFetcher = context.dataFetcher;
        return dataFetcher.fetchData(this.id).then((data) => {
            const renderer = new AmusementVisionRenderer(device, textureHolder);
            return renderer;
        });
    }
}

const id = 'fzgx';
const name = 'F-ZERO GX';
const compressionGFZ = avlz.CompressionMethod.GFZ;
const devCompNone = avlz.CompressionMethod.NONE; //for develop
const sceneDescs = [
    "Rudy Cup",
    new AmusementVisionDesc(devCompNone, "stage01", "mut", "Mute City - Twist Road"),
    new AmusementVisionDesc(compressionGFZ, "stage16", "veg", "Casino Palace - Split Oval"),
    new AmusementVisionDesc(compressionGFZ, "stage26", "san", "Sand Ocean - Surface Slide"),
    new AmusementVisionDesc(compressionGFZ, "stage08", "lig", "Lightning - Loop Cross"),
    new AmusementVisionDesc(compressionGFZ, "stage05", "tow", "Aeropolis - Multiplex"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };