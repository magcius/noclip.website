
import * as Viewer from '../viewer';
import { UnityAssetManager } from '../Common/Unity/AssetManager';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { SceneContext } from '../SceneBase';
import { EmptyScene } from '../Scenes_Test';
import { FakeTextureHolder } from '../TextureHolder';

class FakeTextureScene extends EmptyScene {
    public textureHolder = new FakeTextureHolder([]);
}

class AShortHikeSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const renderer = new FakeTextureScene();

        let assets = new UnityAssetManager('AShortHike/sharedassets2.assets', context, device);
        await assets.loadAssetInfo();

        const texture = await assets.grabATextureIDontCareWhichOne();
        renderer.textureHolder.viewerTextures.push(texture.viewerTexture);

        return renderer;
    }
}

const id = 'AShortHike';
const name = 'A Short Hike';

const sceneDescs = [
    new AShortHikeSceneDesc("test", "test"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, hidden: true };
