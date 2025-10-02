
import * as Viewer from "../viewer.js";

import { SceneContext } from "../SceneBase.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { Mk64Renderer, MarioRacewayRenderer, BowsersCastleRenderer, BansheeBoardwalkRenderer, YoshiValleyRenderer, FrappeSnowlandRenderer, KoopaBeachRenderer, RoyalRacewayRenderer, LuigiRacewayRenderer, ToadsTurnpikeRenderer, KalamariDesertRenderer, SherbetLandRenderer, RainbowRoadRenderer, WarioStadiumRenderer, DkJungleRenderer, MooMooFarmRenderer, Mk64Globals } from "./courses.js";
import { FakeTextureHolder } from "../TextureHolder.js";
import { textureToCanvas } from "../BanjoKazooie/render.js";

const pathBase = `MarioKart64`;

export enum CourseId {
    MarioRaceway = 0,
    ChocoMountain,
    BowserCastle,
    BansheeBoardwalk,
    YoshiValley,
    FrappeSnowland,
    KoopaBeach,
    RoyalRaceway,
    LuigiRaceway,
    MooMooFarm,
    ToadsTurnpike,
    KalamariDesert,
    SherbetLand,
    RainbowRoad,
    WarioStadium,
    BlockFort,
    Skyscraper,
    DoubleDeck,
    DkJungle,
    BigDonut,
}

export class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, public courceId: number, private base: string = pathBase) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const gCurrentCourseId = this.courceId;

        const segTreeLuts = await dataFetcher.fetchData(`${pathBase}/TreeLuts.bin`);
        const segCommonTextures = await dataFetcher.fetchData(`${pathBase}/Segment_3_${gCurrentCourseId}.bin`);
        const segVertexBuffer = await dataFetcher.fetchData(`${pathBase}/Segment_4_${gCurrentCourseId}.bin`);
        const segCourseTextureBuffer = await dataFetcher.fetchData(`${pathBase}/Segment_5_${gCurrentCourseId}.bin`);
        const segCourseData = await dataFetcher.fetchData(`${pathBase}/Segment_6_${gCurrentCourseId}.bin`);
        const segUnpackedDL = await dataFetcher.fetchData(`${pathBase}/Segment_7_${gCurrentCourseId}.bin`);
        const segCommonData = await dataFetcher.fetchData(`${pathBase}/Segment_D.bin`);

        const segmentBuffers: ArrayBufferSlice[] = [];
        segmentBuffers[0x1] = segTreeLuts;
        segmentBuffers[0x3] = segCommonTextures;
        segmentBuffers[0x4] = segVertexBuffer;
        segmentBuffers[0x5] = segCourseTextureBuffer;
        segmentBuffers[0x6] = segCourseData;
        segmentBuffers[0x7] = segUnpackedDL;
        segmentBuffers[0xD] = segCommonData;
        
        const globals = new Mk64Globals(device, segmentBuffers, gCurrentCourseId);

        let renderer: Mk64Renderer;

        switch (gCurrentCourseId) {
            case CourseId.MarioRaceway: renderer = new MarioRacewayRenderer(globals); break;
            case CourseId.BowserCastle: renderer = new BowsersCastleRenderer(globals); break;
            case CourseId.BansheeBoardwalk: renderer = new BansheeBoardwalkRenderer(globals); break;
            case CourseId.YoshiValley: renderer = new YoshiValleyRenderer(globals); break;
            case CourseId.FrappeSnowland: renderer = new FrappeSnowlandRenderer(globals); break;
            case CourseId.KoopaBeach: renderer = new KoopaBeachRenderer(globals); break;
            case CourseId.RoyalRaceway: renderer = new RoyalRacewayRenderer(globals); break;
            case CourseId.LuigiRaceway: renderer = new LuigiRacewayRenderer(globals); break;
            case CourseId.MooMooFarm: renderer = new MooMooFarmRenderer(globals); break;
            case CourseId.ToadsTurnpike: renderer = new ToadsTurnpikeRenderer(globals); break;
            case CourseId.KalamariDesert: renderer = new KalamariDesertRenderer(globals); break;
            case CourseId.SherbetLand: renderer = new SherbetLandRenderer(globals); break;
            case CourseId.RainbowRoad: renderer = new RainbowRoadRenderer(globals); break;
            case CourseId.WarioStadium: renderer = new WarioStadiumRenderer(globals); break;
            case CourseId.DkJungle: renderer = new DkJungleRenderer(globals); break;

            case CourseId.ChocoMountain:
            case CourseId.BlockFort:
            case CourseId.Skyscraper:
            case CourseId.DoubleDeck:
            case CourseId.BigDonut:
                renderer = new Mk64Renderer(globals);
                break;
        }

        const viewerTextures: Viewer.Texture[] = [];

        for (const texture of globals.rspState.textureCache.textures) {
            viewerTextures.push(textureToCanvas(texture));
        }

        renderer!.textureHolder = new FakeTextureHolder(viewerTextures);

        return renderer!;
    }
}

const id = `mk64`;
const name = "Mario Kart 64";
const sceneDescs = [
    "Mushroom Cup",
    new SceneDesc(`lr`, `Luigi Raceway`, CourseId.LuigiRaceway),
    new SceneDesc(`mmf`, `Moo Moo Farm`, CourseId.MooMooFarm),
    new SceneDesc(`ktb`, `Koopa Troopa Beach`, CourseId.KoopaBeach),
    new SceneDesc(`kd`, `Kalimari Desert`, CourseId.KalamariDesert),

    "Flower Cup",
    new SceneDesc(`tt`, `Toad's Turnpike`, CourseId.ToadsTurnpike),
    new SceneDesc(`fs`, `Frappe Snowland`, CourseId.FrappeSnowland),
    new SceneDesc(`cm`, `Choco Mountain`, CourseId.ChocoMountain),
    new SceneDesc(`mr`, `Mario Raceway`, CourseId.MarioRaceway),

    "Star Cup",
    new SceneDesc(`ws`, `Wario Stadium`, CourseId.WarioStadium),
    new SceneDesc(`sl`, `Sherbet Land`, CourseId.SherbetLand),
    new SceneDesc(`rrw`, `Royal Raceway`, CourseId.RoyalRaceway),
    new SceneDesc(`bc`, `Bowser's Castle`, CourseId.BowserCastle),

    "Special Cup",
    new SceneDesc(`djp`, `DK's Jungle Parkway`, CourseId.DkJungle),
    new SceneDesc(`yv`, `Yoshi Valley`, CourseId.YoshiValley),
    new SceneDesc(`bb`, `Banshee Boardwalk`, CourseId.BansheeBoardwalk),
    new SceneDesc(`rr`, `Rainbow Road`, CourseId.RainbowRoad),

    "Battle Mode",
    new SceneDesc(`bf`, `Block Fort`, CourseId.BlockFort),
    new SceneDesc(`ss`, `Skyscraper`, CourseId.Skyscraper),
    new SceneDesc(`dd`, `Double Deck`, CourseId.DoubleDeck),
    new SceneDesc(`bd`, `Big Donut`, CourseId.BigDonut),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
