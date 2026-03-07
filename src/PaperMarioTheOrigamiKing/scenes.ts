import * as BNTX from "../fres_nx/bntx.js";
import * as BFRES from "../fres_nx/bfres.js";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx } from "../viewer.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { FMDLData, FMDLRenderer, PMTOKRenderer } from "./render.js";
import { BRTITextureHolder } from "../fres_nx/render.js";

class ResourceSystem {
    public textureHolder = new BRTITextureHolder();
    public bfresCache = new Map<string, BFRES.FRES | null>();
    public fmdlDataCache = new Map<string, FMDLData | null>();
    private renderCache: GfxRenderCache;

    constructor(device: GfxDevice) {
        this.renderCache = new GfxRenderCache(device);
    }

    public loadFRES(device: GfxDevice, cache: GfxRenderCache, name: string, fres: BFRES.FRES) {
        this.bfresCache.set(name, fres);
        const bntxFile = fres.externalFiles.find((f) => f.name === `${name}.bntx`);
        if (bntxFile) {
            const bntx = BNTX.parse(bntxFile.buffer);
            for (const t of bntx.textures) {
                this.textureHolder.addTexture(device, t);
            }
        } else {
            console.warn("Could not find embedded textures in", name);
        }
        for (const fmdl of fres.fmdl) {
            this.fmdlDataCache.set(fmdl.name, new FMDLData(cache, fmdl));
        }
    }

    public destroy(device: GfxDevice): void {
        this.renderCache.destroy();
        this.textureHolder.destroy(device);
        this.fmdlDataCache.forEach((value) => {
            if (value !== null) {
                value.destroy(device);
            }
        });
    }
}

const pathBase = "PMTOK";
class PMTOKScene implements SceneDesc {
    public id: string;

    constructor(private bfresPath: string, public name: string) {
        this.id = this.bfresPath.split("/")[2].split(".")[0];
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const bfresFile = await context.dataFetcher.fetchData(`${pathBase}/${this.bfresPath}`);
        const fres = BFRES.parse(bfresFile);
        const resourceSystem = new ResourceSystem(device);
        const sceneRenderer = new PMTOKRenderer(device, resourceSystem.textureHolder);
        const cache = sceneRenderer.renderHelper.renderCache;
        resourceSystem.loadFRES(device, cache, this.id, fres);
        for (const fmdlData of resourceSystem.fmdlDataCache.values()) {
            if (fmdlData) {
                const fmdlRenderer = new FMDLRenderer(device, cache, resourceSystem.textureHolder, fmdlData);
                sceneRenderer.fmdlRenderers.push(fmdlRenderer);
            }   
        }
        return sceneRenderer;
    }
}

const id = "PMTOK";
const name = "Paper Mario: The Origami King";
const sceneDescs = [
    "Prologue",
    new PMTOKScene("map/battle/Btl_W0C1_PeachcastleA.bfres", "Battle - Peach Castle"),
    "World 1 (Red Streamer)",
    new PMTOKScene("map/battle/Btl_W1C1_MountainA.bfres",           "Battle - Mountain"),
    new PMTOKScene("map/battle/Btl_W1C2_WaterwayA.bfres",           "Battle - Waterway"),
    new PMTOKScene("map/battle/Btl_W1C3_CaveA.bfres",               "Battle - Cave"),
    new PMTOKScene("map/battle/Btl_W1C3_CaveBossA.bfres",           "Battle - Cave Boss"),
    new PMTOKScene("map/battle/Btl_W1C4_TenbouTowerA.bfres",        "Battle - Overlook Tower"),
    new PMTOKScene("map/battle/Btl_W1C4_TenbouTowerBossA.bfres",    "Battle - Overlook Tower Boss"),
    new PMTOKScene("map/battle/Btl_W1G1_KinokoTownA.bfres",         "Battle - Toad Town A"),
    new PMTOKScene("map/battle/Btl_W1G1_KinokoTownB.bfres",         "Battle - Toad Town B"),
    new PMTOKScene("map/battle/Btl_W1G2_HillA.bfres",               "Battle - Hill"),
    new PMTOKScene("map/battle/Btl_W1G3_ObservatoryA.bfres",        "Battle - Observatory")
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
