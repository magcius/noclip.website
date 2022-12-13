import * as Viewer from '../viewer';
import { DeviceProgram } from '../Program';
import { SceneContext } from '../SceneBase';
import { fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';
import { GfxDevice, makeTextureDescriptor2D, GfxBuffer, GfxInputState, GfxProgram, GfxBindingLayoutDescriptor } from '../gfx/platform/GfxPlatform';
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

let _wasm: typeof import('../../rust/pkg/index') | null = null;

async function loadWasm() {
    if (_wasm === null) {
        _wasm = await import('../../rust/pkg/index');
    }
    return _wasm;
}

class HaloScene extends EmptyScene {
    public textureHolder = new FakeTextureHolder([]);
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
        const bitmap = mapManager.get_bitmaps_js()[0];
        const bitmapData = mapManager.read_bitmap_data_js(bitmap, 0);
        console.log(bitmapData);
        let texDesc = makeTextureDescriptor2D(GfxFormat.BC2, 512, 512, 1);
        let tex = device.createTexture(texDesc);
        device.uploadTextureData(tex, 0, [bitmapData]);
        const renderer = new HaloScene();
        return renderer;
    }

}

const id = 'Halo';
const name = 'Halo';

const sceneDescs = [
    new HaloSceneDesc("lmao", "lmao"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, hidden: false };