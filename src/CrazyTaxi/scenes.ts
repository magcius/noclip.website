import * as Viewer from '../viewer.js';
import { GfxDevice, GfxInputLayout, GfxProgram } from '../gfx/platform/GfxPlatform.js';
import { SceneContext } from '../SceneBase.js';
import { IVRenderer } from '../DarkSoulsCollisionData/render.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInstList } from '../gfx/render/GfxRenderInstManager.js';
import { rust } from '../rustlib.js';

export class Scene implements Viewer.SceneGfx {
    private inputLayout: GfxInputLayout;
    private program: GfxProgram;
    private ivRenderers: IVRenderer[] = [];
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();

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
        console.log(fileManager.get_file("TY_psgAL_shoe1.tex"));
        return new Scene(gfxDevice);
    }
}

const sceneDescs: SceneDesc[] = [
    new SceneDesc('level0', 'Main Level'),
];

const name = "Crazy Taxi";
const id = "crazytaxi";

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
