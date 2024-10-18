
import * as Viewer from "./viewer.js";
import { GfxDevice } from "./gfx/platform/GfxPlatform.js";
import { SceneContext } from "./SceneBase.js";

import { createBasicRRESRendererFromBRRES } from "./rres/scenes.js";
import * as H3D from "./Common/CTR_H3D/H3D.js";
import * as NARC from "./nns_g3d/narc.js";
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "./gfx/helpers/RenderGraphHelpers.js";
import { GfxRenderHelper } from "./gfx/render/GfxRenderHelper.js";
import { GfxrAttachmentSlot } from "./gfx/render/GfxRenderGraph.js";

const id = 'test';
const name = "Test Scenes";

export class EmptyScene implements Viewer.SceneGfx {
    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
    }

    public destroy(device: GfxDevice): void {
    }
}

class EmptyClearScene implements Viewer.SceneGfx {
    private renderHelper: GfxRenderHelper;

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const desc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const mainColorID = builder.createRenderTargetID(desc, "Main Color");

        builder.pushPass((pass) => {
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorID);
        });

        builder.resolveRenderTargetToExternalTexture(mainColorID, viewerInput.onscreenTexture);

        this.renderHelper.renderGraph.execute(builder);
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
    }
}

class EmptyClearSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name = id) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        return new EmptyClearScene(device);
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
    new EmptyClearSceneDesc('EmptyClearScene'),
    new BasicRRESSceneDesc('test/dthro_cmn1.brres'),
    new NARCSceneDesc('test/land_data.narc'),
];

export const sceneGroup: Viewer.SceneGroup = {
    id, name, sceneDescs, hidden: true,
};
