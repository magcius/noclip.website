import * as Viewer from '../viewer';
import { DeviceProgram } from '../Program';
import { SceneContext } from '../SceneBase';
import { fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';
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

class HaloRenderer implements Viewer.SceneGfx {
    constructor(public device: GfxDevice) {

    }

    public render(device: GfxDevice, renderInput: Viewer.ViewerRenderInput): void {
        
    }

    public destroy(device: GfxDevice): void {
        
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
        const mapManager = wasm.HaloSceneManager.new(mapData.createTypedArray(Uint8Array), resourceMapData.createTypedArray(Uint8Array);
        let materials = mapManager.get_materials();
        console.log(materials[0].get_vertices());
        console.log(materials[0].get_indices());
        const renderer = new HaloRenderer(device);
        return renderer;
    }

}

const id = 'Halo';
const name = 'Halo';

const sceneDescs = [
    new HaloSceneDesc("lmao", "lmao"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, hidden: false };