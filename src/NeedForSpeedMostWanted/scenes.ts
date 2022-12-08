import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneGroup, SceneDesc, SceneContext } from "../SceneBase";
import { SceneGfx } from "../viewer";
import { NfsMap } from "./map";
import { NfsRenderer } from "./render";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";

class NfsSceneDesc implements SceneDesc {
    public async createScene(device: GfxDevice, sceneContext: SceneContext): Promise<SceneGfx> {
        const mapFile = await sceneContext.dataFetcher.fetchData(`${dataPath}/${this.baseFile}`);
        const globalIngameFile = await sceneContext.dataFetcher.fetchData(`${dataPath}/GLOBAL/InGameA.bun`);
        const globalIngameFileB = await sceneContext.dataFetcher.fetchData(`${dataPath}/GLOBAL/InGameB.bun`);
        const globalB = await sceneContext.dataFetcher.fetchData(`${dataPath}/GLOBAL/GLOBALB.bun`, { allow404: true });
        const renderHelper = new GfxRenderHelper(device);

        const map: NfsMap = new NfsMap(sceneContext.dataFetcher, `${dataPath}/${this.streamFile}`);
        await map.parse(device, renderHelper, mapFile, globalIngameFile, globalIngameFileB, globalB);

        return new NfsRenderer(map, device, renderHelper);
    }

    constructor(public id: string, public name: string, private baseFile: string, private streamFile: string) {}

}

const dataPath = "NeedForSpeedMostWanted";

const sceneDescs = [
    new NfsSceneDesc("rockport", "Rockport City", "TRACKS/L2RA.BUN", "TRACKS/STREAML2RA.BUN")
];

const id = 'nfsmw';
const name = "Need for Speed: Most Wanted (2005)";
export const sceneGroup: SceneGroup = {
    id, name, sceneDescs,
};
