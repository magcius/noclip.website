
import * as Viewer from "./viewer";
import Progressable from "./Progressable";
import { GfxDevice } from "./gfx/platform/GfxPlatform";
import { fetchData } from "./fetch";
import { createBasicRRESRendererFromBRRES } from "./rres/scenes";
import { WindWakerWater } from "./test/Scenes_WindWakerWater";
import { IS_DEVELOPMENT } from "./BuildVersion";

const id = 'test';
const name = "Test Scenes";

class BasicRRESSceneDesc implements Viewer.SceneDesc {
    constructor(public dataPath: string, public id: string = dataPath, public name: string = dataPath) {}

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        return fetchData(this.dataPath, abortSignal).then((data) => {
            return createBasicRRESRendererFromBRRES(device, [data]);
        });
    }
}

const sceneDescs = [
    new BasicRRESSceneDesc('test/dthro_cmn1.brres'),
    new WindWakerWater('www', "Wind Waker Water"),
];

export const sceneGroup: Viewer.SceneGroup = {
    id, name, sceneDescs, hidden: !IS_DEVELOPMENT,
};
