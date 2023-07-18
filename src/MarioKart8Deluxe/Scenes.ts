
import * as Yaz0 from "../Common/Compression/Yaz0.js";
import * as BFRES from "../fres_nx/bfres.js";
import * as SARC from "../fres_nx/sarc.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { TurboRenderer, BRTITextureHolder, FMDLData, FMDLRenderer, TurboRenderGlobals, TurboLightEnv, TurboCommonRes } from "./Render.js";

const pathBase = `MarioKart8Deluxe`;

class MarioKart8SceneDesc implements SceneDesc {
    constructor(coursePath: string, courseName: string, public name: string = courseName, public id: string = coursePath) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<TurboRenderer> {
        const commonRes = await context.dataShare.ensureObject(`${pathBase}/TurboCommonRes`, async () => {
            const common = new TurboCommonRes();
            common.commonGEnv = SARC.parse(await context.dataFetcher.fetchData(`${pathBase}/Common/GEnv/Turbo_cmn.bgenv`));;
            return common;
        });

        const dataFetcher = context.dataFetcher;
        const courseDir = `${pathBase}/Course/${this.id}`;

        const fres = BFRES.parse(await Yaz0.decompress(await dataFetcher.fetchData(`${courseDir}/course_model.szs`)));

        const textureHolder = new BRTITextureHolder();

        const texturesFile = fres.externalFiles.find((file) => file.name === 'textures.bntx');
        textureHolder.addBNTXFile(device, texturesFile!.buffer);

        const renderGlobals = new TurboRenderGlobals();
        renderGlobals.lightEnv = new TurboLightEnv(await dataFetcher.fetchData(`${courseDir}/course.bgenv`), commonRes);
        renderGlobals.textureHolder = textureHolder;

        const renderer = new TurboRenderer(device, renderGlobals);
        const cache = renderer.renderHelper.renderCache;

        for (let i = 0; i < fres.fmdl.length; i++) {
            const fmdlData = new FMDLData(cache, fres.fmdl[i]);
            context.destroyablePool.push(fmdlData);

            const fmdlRenderer = new FMDLRenderer(device, cache, textureHolder, fmdlData);
            renderer.fmdlRenderers.push(fmdlRenderer);
        }

        return renderer;
    }
}

const id = 'MarioKart8Deluxe';
const name = 'Mario Kart 8 Deluxe';
const sceneDescs = [
    "Mushroom Cup",
    new MarioKart8SceneDesc('Gu_FirstCircuit', "Mario Kart Stadium"),
    new MarioKart8SceneDesc('Gu_WaterPark', "Water Park"),
    new MarioKart8SceneDesc('Gu_Cake', "Sweet Sweet Canyon"),
    new MarioKart8SceneDesc('Gu_DossunIseki', "Thwomp Ruins"),
    "Flower Cup",
    new MarioKart8SceneDesc('Gu_MarioCircuit', "Mario Circuit"),
    new MarioKart8SceneDesc('Gu_City', "Toad Harbor"),
    new MarioKart8SceneDesc('Gu_HorrorHouse', "Twisted Mansion"),
    new MarioKart8SceneDesc('Gu_Expert', "Shy Guy Falls"),
    "Star Cup",
    new MarioKart8SceneDesc('Gu_Airport', "Sunshine Airport"),
    new MarioKart8SceneDesc('Gu_Ocean', "Dolphin Shoals"),
    new MarioKart8SceneDesc('Gu_Techno', "Electrodrome"),
    new MarioKart8SceneDesc('Gu_SnowMountain', "Mount Wario"),
    "Special Cup",
    new MarioKart8SceneDesc('Gu_Cloud', "Cloudtop Cruise"),
    new MarioKart8SceneDesc('Gu_Desert', "Bone-Dry Dunes"),
    new MarioKart8SceneDesc('Gu_BowserCastle', "Bowser's Castle"),
    new MarioKart8SceneDesc('Gu_RainbowRoad', "Rainbow Road"),
    "Shell Cup",
    new MarioKart8SceneDesc('Gwii_MooMooMeadows', "Wii Moo Moo Meadows"),
    new MarioKart8SceneDesc('Gagb_MarioCircuit', "GBA Mario Circuit"),
    new MarioKart8SceneDesc('Gds_PukupukuBeach', "DS Cheep Cheep Beach"),
    new MarioKart8SceneDesc('G64_KinopioHighway', "N64 Toad's Turnpike"),
    "Banana Cup",
    new MarioKart8SceneDesc('Ggc_DryDryDesert', "GCN Dry Dry Desert"),
    new MarioKart8SceneDesc('Gsfc_DonutsPlain3', "SNES Donut Plains 3"),
    new MarioKart8SceneDesc('G64_PeachCircuit', "N64 Royal Raceway"),
    new MarioKart8SceneDesc('G3ds_DKJungle', "3DS DK Jungle"),
    "Leaf Cup",
    new MarioKart8SceneDesc('Gds_WarioStadium', "DS Wario Stadium"),
    new MarioKart8SceneDesc('Ggc_SherbetLand', "GCN Sherbet Land"),
    new MarioKart8SceneDesc('G3ds_MusicPark', "3DS Music Park"),
    new MarioKart8SceneDesc('G64_YoshiValley', "N64 Yoshi Valley"),
    "Lightning Cup",
    new MarioKart8SceneDesc('Gds_TickTockClock', "DS Tick-Tock Clock"),
    new MarioKart8SceneDesc('G3ds_PackunSlider', "3DS Piranha Plant Slide"),
    new MarioKart8SceneDesc('Gwii_GrumbleVolcano', "Wii Grumble Volcano"),
    new MarioKart8SceneDesc('G64_RainbowRoad', "N64 Rainbow Road"),
    "Egg Cup",
    new MarioKart8SceneDesc('Dgc_YoshiCircuit', "GCN Yoshi Circuit"),
    new MarioKart8SceneDesc('Du_ExciteBike', "Excitebike Arena"),
    new MarioKart8SceneDesc('Du_DragonRoad', "Dragon Driftway"),
    new MarioKart8SceneDesc('Du_MuteCity', "Mute City"),
    "Triforce Cup",
    new MarioKart8SceneDesc('Dwii_WariosMine', "Wii Wario's Gold Mine"),
    new MarioKart8SceneDesc('Dsfc_RainbowRoad', "SNES Rainbow Road"),
    new MarioKart8SceneDesc('Du_IcePark', "Ice Ice Outpost"),
    new MarioKart8SceneDesc('Du_Hyrule', "Hyrule Circuit"),
    "Crossing Cup",
    new MarioKart8SceneDesc('Dgc_BabyPark', "GCN Baby Park"),
    new MarioKart8SceneDesc('Dagb_CheeseLand', "GBA Cheese Land"),
    new MarioKart8SceneDesc('Du_Woods', "Wild Woods"),
    new MarioKart8SceneDesc('Du_Animal_Spring', "Animal Crossing (Spring)"),
    new MarioKart8SceneDesc('Du_Animal_Summer', "Animal Crossing (Summer)"),
    new MarioKart8SceneDesc('Du_Animal_Autumn', "Animal Crossing (Autumn)"),
    new MarioKart8SceneDesc('Du_Animal_Winter', "Animal Crossing (Winter)"),
    "Bell Cup",
    new MarioKart8SceneDesc('D3ds_NeoBowserCity', "3DS Neo Bowser City"),
    new MarioKart8SceneDesc('Dagb_RibbonRoad', "GBA Ribbon Road"),
    new MarioKart8SceneDesc('Du_Metro', "Super Bell Subway"),
    new MarioKart8SceneDesc('Du_BigBlue', "Big Blue"),
    "Battle Courses",
    new MarioKart8SceneDesc('Bu_BattleStadium', "Battle Stadium"),
    new MarioKart8SceneDesc('Bu_Sweets', "Sweet Sweet Kingdom"),
    new MarioKart8SceneDesc('Bu_Dojo', "Dragon Palace"),
    new MarioKart8SceneDesc('Bu_Moon', "Lunar Colony"),
    new MarioKart8SceneDesc('B3ds_WuhuTown', "3DS Wuhu Town"),
    new MarioKart8SceneDesc('Bgc_LuigiMansion', "GCN Luigi's Mansion"),
    new MarioKart8SceneDesc('Bsfc_Battle1', "SNES Battle Course 1"),
    new MarioKart8SceneDesc('Bu_DekaLine', "Urchin Underpass"),
];
export const sceneGroup: SceneGroup = { id, name, sceneDescs };
