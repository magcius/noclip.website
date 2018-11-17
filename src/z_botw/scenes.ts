
import * as Viewer from "../viewer";
import * as Yaz0 from "../compression/Yaz0";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import Progressable from "../Progressable";
import { fetchData } from "../fetch";
import * as TSCB from "./tscb";
import * as BFRES from "../fres/bfres";
import { fetchAreaData, TerrainManager } from "./tera";
import { TerrainScene, LoadedTerrainArea } from "./render";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { GX2TextureHolder } from "../fres/render";

function decodeFRES(buffer: ArrayBufferSlice): Progressable<BFRES.FRES> {
    return new Progressable(Yaz0.decompress(buffer)).then((d) => BFRES.parse(d));
}

const pathBase = `data/z_botw`;
export class TerrainSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public createScene_Device(device: GfxDevice): Progressable<Viewer.Scene_Device> {
        const teraPath = `${pathBase}/Terrain/A/${this.id}`;
        return Progressable.all([fetchData(`${pathBase}/Model/Terrain.Tex1.sbfres`), fetchData(`${teraPath}.tscb`)]).then(([terrainTexBuffer, tscbBuffer]) => {
            const tscb = TSCB.parse(tscbBuffer);

            return decodeFRES(terrainTexBuffer).then((terrainFRES) => {
                const terrainManager = new TerrainManager(tscb, terrainFRES, teraPath);
                console.log(terrainManager);

                const textureHolder = new GX2TextureHolder();
                // Mangle things a bit.
                const textureEntries = terrainFRES.ftex.filter((e) => e.name.startsWith('Material'));
                for (let i = 0; i < textureEntries.length; i++) {
                    textureEntries[i].ftex.surface.numMips = 1;
                }
                textureHolder.addTexturesGfx(device, textureEntries);

                return fetchAreaData(teraPath, tscb.areaInfos[0]).then((area) => {
                    const loadedArea = terrainManager.loadArea(device, area);
                    const terrainScene = new TerrainScene(device, textureHolder, loadedArea);
                    return terrainScene;
                });
            });
        });
    }
}

const id = "z_botw";
const name = "Breath of the Wild";
const sceneDescs = [
    new TerrainSceneDesc("MainField", "MainField"),
];
export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
