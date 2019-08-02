
import * as Viewer from "./viewer";
import Progressable from "./Progressable";
import { GfxDevice } from "./gfx/platform/GfxPlatform";
import { fetchData } from "./fetch";
import { createBasicRRESRendererFromBRRES } from "./rres/scenes";
import { IS_DEVELOPMENT } from "./BuildVersion";
import { SceneContext } from "./SceneBase";

const id = 'test';
const name = "Test Scenes";

class BasicRRESSceneDesc implements Viewer.SceneDesc {
    constructor(public dataPath: string, public id: string = dataPath, public name: string = dataPath) {}

    public createScene(device: GfxDevice, context: SceneContext): Progressable<Viewer.SceneGfx> {
        const abortSignal = context.abortSignal;
        return fetchData(this.dataPath, abortSignal).then((data) => {
            return createBasicRRESRendererFromBRRES(device, [data]);
        });
    }
}

const sceneDescs = [
    new BasicRRESSceneDesc('test/dthro_cmn1.brres'),
];

export const sceneGroup: Viewer.SceneGroup = {
    id, name, sceneDescs, hidden: !IS_DEVELOPMENT,
};
