import { CameraController } from '../Camera';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { SceneContext } from '../SceneBase';
import * as Viewer from '../viewer';
import { loadArchive } from "./archive";

export class ROTFDRenderer implements Viewer.SceneGfx {
    public renderHelper: GfxRenderHelper;

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    adjustCameraController?(c: CameraController) {

    }
    onstatechanged() {

    }
    render(device: GfxDevice, renderInput: Viewer.ViewerRenderInput) {

    }
    destroy(device: GfxDevice) {

    }
}

class RotfdSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    public async createScene(gfxDevice: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const renderer = new ROTFDRenderer(gfxDevice);

        const archive = await loadArchive(context.dataFetcher, this.id);

        return renderer;
    }
}

const sceneDescs = [
    'Main Menu',
    new RotfdSceneDesc('BB/MAINMENU', 'Main Menu'),
    'Bikini Bottom',
    new RotfdSceneDesc('BB/LVL_BBEX', 'Bikini Bottom'),
    new RotfdSceneDesc('BB/LVL_BBKK', 'Krusty Krab'),
    new RotfdSceneDesc('BB/LVL_BBKM', 'Karate Minigame'),
    new RotfdSceneDesc('BB/LVL_BBSH', 'Spongebob\'s House'),
    new RotfdSceneDesc('BB/LVL_BBTP', 'Tile Puzzle'),
];

const id = 'rotfd';
const name = "SpongeBob SquarePants: Revenge of the Flying Dutchman";
export const sceneGroup: Viewer.SceneGroup = {
    id, name, sceneDescs,
};