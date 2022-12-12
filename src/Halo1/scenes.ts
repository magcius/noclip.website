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

        const mapManager = wasm.MapManager.new(mapData.createTypedArray(Uint8Array));
        const bitmapManager = wasm.ResourceManager.new(resourceMapData.createTypedArray(Uint8Array));
        const bitmapTag = mapManager.get_bitmaps()[0];
        const bitmap = bitmapTag.as_bitmap();
        console.log(bitmapTag.get_path());
        const bitmapData = bitmapManager.get_resource_data(bitmapTag)!;
        console.log(bitmap);
        let texDesc = makeTextureDescriptor2D(GfxFormat.BC2, bitmap.color_plate_height, bitmap.color_plate_width, 1);
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