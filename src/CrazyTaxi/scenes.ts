import * as Viewer from '../viewer.js';
import { GfxDevice, GfxInputLayout, GfxProgram } from '../gfx/platform/GfxPlatform.js';
import { SceneContext } from '../SceneBase.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInstList } from '../gfx/render/GfxRenderInstManager.js';
import { rust } from '../rustlib.js';
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import * as GX from '../gx/gx_enum.js';
import * as GXTexture from '../gx/gx_texture.js';
import { NamedArrayBufferSlice } from '../DataFetcher.js';
import { GXTextureHolder } from '../gx/gx_render.js';
import { hexdump } from '../DebugJunk.js';

function parseTex(name: string, buffer: ArrayBufferSlice): GXTexture.TextureInputGX {
    const view = buffer.createDataView();
    const width = view.getUint32(0x00, false);
    const height = view.getUint32(0x04, false);
    const unk = view.getUint32(0x08, false);
    const format: GX.TexFormat = view.getUint32(0x0C, false);
    const mipCount = 1; // ???
    const data = buffer.slice(0x60);

    return {
        name,
        width, height, mipCount,
        format, data,
    };
}

export class Scene implements Viewer.SceneGfx {
    private inputLayout: GfxInputLayout;
    private program: GfxProgram;
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    public textureHolder = new GXTextureHolder();

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
    }
}

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(gfxDevice: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const fileManager = rust.CTFileManager.new();
        const files = [
            "polDC0.all",
            "texDC0.all",
        ];
        for (const file of files) {
            const basePath = "CrazyTaxi/files/ct";
            const data = await dataFetcher.fetchData(`${basePath}/${file}`);
            fileManager.append_archive(data.createTypedArray(Uint8Array));
        }
        console.log(fileManager.list_files(".shp"));
        console.log(fileManager.list_files(".tex"));
        const textures: GXTexture.TextureInputGX[] = [];
        for (const filename of fileManager.list_files(".tex")) {
            const texData = new ArrayBufferSlice(fileManager.get_file(filename)!.buffer);
            console.log(texData, texData.byteLength);
            hexdump(texData);
            const tex = parseTex(filename, texData);
            textures.push(tex);
        }
        const scene = new Scene(gfxDevice);
        scene.textureHolder.addTextures(gfxDevice, textures);
        return scene;
    }
}

const sceneDescs: SceneDesc[] = [
    new SceneDesc('level0', 'Main Level'),
];

const name = "Crazy Taxi";
const id = "crazytaxi";

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
