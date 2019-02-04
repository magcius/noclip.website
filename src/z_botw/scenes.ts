
import * as Viewer from "../viewer";
import * as Yaz0 from "../compression/Yaz0";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import Progressable from "../Progressable";
import { fetchData } from "../fetch";
import * as TSCB from "./tscb";
import * as BFRES from "../fres/bfres";
import { TerrainManager } from "./tera";
import { TerrainScene } from "./render";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { GX2TextureHolder } from "../fres/render";

function decodeFRES(buffer: ArrayBufferSlice): Progressable<BFRES.FRES> {
    return new Progressable(Yaz0.decompress(buffer)).then((d) => BFRES.parse(d));
}

const pathBase = `z_botw`;
export class TerrainSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        const teraPath = `${pathBase}/Terrain/A/${this.id}`;
        return Progressable.all([fetchData(`${pathBase}/Model/Terrain.Tex1.sbfres`, abortSignal), fetchData(`${pathBase}/Model/Terrain.Tex2.sbfres`), fetchData(`${teraPath}.tscb`, abortSignal)]).then(([terrainTex1Buffer, terrainTex2Buffer, tscbBuffer]) => {
            const tscb = TSCB.parse(tscbBuffer);

            return Progressable.all([decodeFRES(terrainTex1Buffer), decodeFRES(terrainTex2Buffer)]).then(([tex1, tex2]) => {
                const terrainManager = new TerrainManager(device, abortSignal, tscb, tex1, teraPath);
                console.log(tex1, tex2);
                const textureHolder = new GX2TextureHolder();
                // Mangle things a bit.
                const textureEntries1 = tex1.ftex.filter((e) => e.name.startsWith('Material'));
                const textureEntries2 = tex2.ftex.filter((e) => e.name.startsWith('Material'));
                for (let i = 0; i < textureEntries1.length; i++) {
                    const ftex = textureEntries1[i].ftex;
                    ftex.mipData = textureEntries2[i].ftex.texData;
                    // TODO(jstpierre): Turn back on once we can parse mips better.
                    ftex.surface.numMips = 5;
                }
                textureHolder.addTextures(device, textureEntries1);

                return new TerrainScene(device, textureHolder, terrainManager);
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
