import * as Viewer from '../viewer';
import { DeviceProgram } from '../Program';
import { SceneContext } from '../SceneBase';
import { fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';
import { Tag } from '../../rust/pkg/index';
import { GfxDevice, makeTextureDescriptor2D, GfxBuffer, GfxInputState, GfxProgram, GfxBindingLayoutDescriptor, GfxTexture, GfxCullMode } from '../gfx/platform/GfxPlatform';
import { GfxFormat } from "../gfx/platform/GfxPlatformFormat";
import { makeBackbufferDescSimple, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { mat4, vec3 } from 'gl-matrix';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { UnityAssetManager, MeshMetadata, UnityMesh, UnityChannel } from '../Common/Unity/AssetManager';
import { AABB } from '../Geometry';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { EmptyScene } from '../Scenes_Test';
import { FakeTextureHolder } from '../TextureHolder';
import { decompressBC } from '../Common/bc_texture';
import { preprocessProgram_GLSL } from '../gfx/shaderc/GfxShaderCompiler';
import { CameraController } from '../Camera';
import { GfxShaderLibrary } from '../gfx/helpers/GfxShaderLibrary';
import { bindingLayouts } from '../Glover/render';
import { UI } from '../ui';
import { fullscreenMegaState } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';

let _wasm: typeof import('../../rust/pkg/index') | null = null;
type Wasm = typeof _wasm!;

async function loadWasm() {
    if (_wasm === null) {
        _wasm = await import('../../rust/pkg/index');
    }
    return _wasm;
}
export class Scene implements Viewer.SceneGfx {
    private program: GfxProgram;
    private renderHelper: GfxRenderHelper;

    constructor(device: GfxDevice, private texture: GfxTexture) {
        this.renderHelper = new GfxRenderHelper(device);
        const blitProgram = preprocessProgram_GLSL(device.queryVendorInfo(), GfxShaderLibrary.fullscreenVS, GfxShaderLibrary.fullscreenBlitOneTexPS);
        this.program = this.renderHelper.renderCache.createProgramSimple(blitProgram);
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setMegaStateFlags(fullscreenMegaState);
        template.setBindingLayouts([{ numUniformBuffers: 0, numSamplers: 1}]);

        const renderInst = this.renderHelper.renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.program);
        renderInst.drawPrimitives(3);
        renderInst.setSamplerBindingsFromTextureMappings([{ gfxTexture: this.texture, gfxSampler: null, lateBinding: null }]);
        this.renderHelper.renderInstManager.submitRenderInst(renderInst);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstManager.drawOnPassRenderer(passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        device.destroyProgram(this.program);
        this.renderHelper.destroy();
    }
}


class HaloSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const wasm = await loadWasm();
        wasm.init_panic_hook();
        const dataFetcher = context.dataFetcher;
        const resourceMapData = await dataFetcher.fetchData("halo/bitmaps.map");
        const mapData = await dataFetcher.fetchData("halo/bloodgulch.map");

        const mapManager = wasm.MapManager.new_js(mapData.createTypedArray(Uint8Array), resourceMapData.createTypedArray(Uint8Array);
        const bitmap = mapManager.get_bitmaps_js()[0] as Tag;
        const bitmapData = mapManager.read_bitmap_data_js(bitmap, 0);
        const width = 512;
        const height = 512;
        const pixels = bitmapData.slice(0, 512 * 512);
        console.log(bitmapData);
        let texDesc = makeTextureDescriptor2D(GfxFormat.BC2, 512, 512, 1);
        let tex = device.createTexture(texDesc);
        device.uploadTextureData(tex, 0, [pixels]);
        const renderer = new Scene(device, tex);
        return renderer;
    }

}

const id = 'Halo';
const name = 'Halo';

const sceneDescs = [
    new HaloSceneDesc("lmao", "lmao"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, hidden: false };