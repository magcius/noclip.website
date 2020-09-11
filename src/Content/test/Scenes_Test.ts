
import * as Viewer from "../../viewer";
import { GfxDevice, GfxRenderPass } from "../../gfx/platform/GfxPlatform";
import { SceneContext } from "../../SceneBase";

import { createBasicRRESRendererFromBRRES } from "../../rres/scenes";
import * as H3D from "../../Common/CTR_H3D/H3D";
import { CtrTextureHolder } from "../oot3d/render";
import * as NARC from "../../nns_g3d/narc";

const id = 'test';
const name = "Test Scenes";

export class EmptyScene implements Viewer.SceneGfx {
    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        return null as unknown as GfxRenderPass;
    }

    public destroy(device: GfxDevice): void {
    }
}

class BasicRRESSceneDesc implements Viewer.SceneDesc {
    constructor(public dataPath: string, public id: string = dataPath, public name: string = dataPath) {}

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        return dataFetcher.fetchData(this.dataPath).then((data) => {
            return createBasicRRESRendererFromBRRES(device, [data]);
        });
    }
}

class H3DScene extends EmptyScene {
    public textureHolder = new CtrTextureHolder();
}

class H3DSceneDesc implements Viewer.SceneDesc {
    constructor(public dataPath: string, public id: string = dataPath, public name: string = dataPath) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const data = await dataFetcher.fetchData(this.dataPath);
        const h3d = H3D.parse(data);
        const renderer = new H3DScene();
        renderer.textureHolder.addTextures(device, h3d.textures);
        return renderer;
    }
}

class NARCSceneDesc implements Viewer.SceneDesc {
    constructor(public dataPath: string, public id: string = dataPath, public name: string = dataPath) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const data = await dataFetcher.fetchData(this.dataPath);
        const narc = NARC.parse(data);
        console.log(narc);
        return new EmptyScene();
    }
}

const sceneDescs = [
    new BasicRRESSceneDesc('test/dthro_cmn1.brres'),
    new H3DSceneDesc('test/cave_Common.bch'),
    new NARCSceneDesc('test/land_data.narc'),
];

export const sceneGroup: Viewer.SceneGroup = {
    id, name, sceneDescs, hidden: true,
};
