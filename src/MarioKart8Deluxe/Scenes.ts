
import * as Yaz0 from "../Common/Compression/Yaz0";
import * as BFRES from "../fres_nx/bfres";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { TurboRenderer, BRTITextureHolder, FMDLData, FMDLRenderer, TurboRenderGlobals, TurboLightEnv } from "./Render";

const pathBase = `MarioKart8Deluxe`;

class MarioKart8SceneDesc implements SceneDesc {
    constructor(coursePath: string, public name: string = coursePath, public id: string = coursePath) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<TurboRenderer> {
        const dataFetcher = context.dataFetcher;
        const courseDir = `${pathBase}/Course/${this.id}`;

        const fres = BFRES.parse(await Yaz0.decompress(await dataFetcher.fetchData(`${courseDir}/course_model.szs`)));

        const textureHolder = new BRTITextureHolder();

        const texturesFile = fres.externalFiles.find((file) => file.name === 'textures.bntx');
        textureHolder.addBNTXFile(device, texturesFile!.buffer);

        const renderGlobals = new TurboRenderGlobals();
        renderGlobals.lightEnv = new TurboLightEnv(await dataFetcher.fetchData(`${courseDir}/course.bgenv`));
        renderGlobals.textureHolder = textureHolder;

        const renderer = new TurboRenderer(device, renderGlobals);
        const cache = renderer.renderHelper.renderCache;

        for (let i = 0; i < fres.fmdl.length; i++) {
            const fmdlData = new FMDLData(device, fres.fmdl[i]);
            context.destroyablePool.push(fmdlData);

            const fmdlRenderer = new FMDLRenderer(device, cache, textureHolder, fmdlData);
            renderer.fmdlRenderers.push(fmdlRenderer);
        }

        return renderer;
    }
}

const id = 'MarioKart8Deluxe';
const name = 'Mario Kart 8: Deluxe';
const sceneDescs = [
    new MarioKart8SceneDesc('B3ds_WuhuTown'),
    new MarioKart8SceneDesc('Bgc_LuigiMansion'),
    new MarioKart8SceneDesc('Bsfc_Battle1'),
    new MarioKart8SceneDesc('Bu_BattleStadium'),
    new MarioKart8SceneDesc('Bu_DekaLine'),
    new MarioKart8SceneDesc('Bu_Dojo'),
    new MarioKart8SceneDesc('Bu_Moon'),
    new MarioKart8SceneDesc('Bu_Sweets'),
    new MarioKart8SceneDesc('D3ds_NeoBowserCity'),
    new MarioKart8SceneDesc('Dagb_CheeseLand'),
    new MarioKart8SceneDesc('Dagb_RibbonRoad'),
    new MarioKart8SceneDesc('Dgc_BabyPark'),
    new MarioKart8SceneDesc('Dgc_YoshiCircuit'),
    new MarioKart8SceneDesc('Dsfc_RainbowRoad'),
    new MarioKart8SceneDesc('Du_Animal_Autumn'),
    new MarioKart8SceneDesc('Du_Animal_Spring'),
    new MarioKart8SceneDesc('Du_Animal_Summer'),
    new MarioKart8SceneDesc('Du_Animal_Winter'),
    new MarioKart8SceneDesc('Du_BigBlue'),
    new MarioKart8SceneDesc('Du_DragonRoad'),
    new MarioKart8SceneDesc('Du_ExciteBike'),
    new MarioKart8SceneDesc('Du_Hyrule'),
    new MarioKart8SceneDesc('Du_IcePark'),
    new MarioKart8SceneDesc('Du_Metro'),
    new MarioKart8SceneDesc('Du_MuteCity'),
    new MarioKart8SceneDesc('Du_Woods'),
    new MarioKart8SceneDesc('Dwii_WariosMine'),
    new MarioKart8SceneDesc('G3ds_DKJungle'),
    new MarioKart8SceneDesc('G3ds_MusicPark'),
    new MarioKart8SceneDesc('G3ds_PackunSlider'),
    new MarioKart8SceneDesc('G64_KinopioHighway'),
    new MarioKart8SceneDesc('G64_PeachCircuit'),
    new MarioKart8SceneDesc('G64_RainbowRoad'),
    new MarioKart8SceneDesc('G64_YoshiValley'),
    new MarioKart8SceneDesc('Gagb_MarioCircuit'),
    new MarioKart8SceneDesc('Gds_PukupukuBeach'),
    new MarioKart8SceneDesc('Gds_TickTockClock'),
    new MarioKart8SceneDesc('Gds_WarioStadium'),
    new MarioKart8SceneDesc('Ggc_DryDryDesert'),
    new MarioKart8SceneDesc('Ggc_SherbetLand'),
    new MarioKart8SceneDesc('Gsfc_DonutsPlain3'),
    new MarioKart8SceneDesc('Gu_Airport'),
    new MarioKart8SceneDesc('Gu_BowserCastle'),
    new MarioKart8SceneDesc('Gu_Cake'),
    new MarioKart8SceneDesc('Gu_City'),
    new MarioKart8SceneDesc('Gu_Cloud'),
    new MarioKart8SceneDesc('Gu_Desert'),
    new MarioKart8SceneDesc('Gu_DossunIseki'),
    new MarioKart8SceneDesc('Gu_Expert'),
    new MarioKart8SceneDesc('Gu_FirstCircuit'),
    new MarioKart8SceneDesc('Gu_HorrorHouse'),
    new MarioKart8SceneDesc('Gu_MarioCircuit'),
    new MarioKart8SceneDesc('Gu_Ocean'),
    new MarioKart8SceneDesc('Gu_RainbowRoad'),
    new MarioKart8SceneDesc('Gu_SnowMountain'),
    new MarioKart8SceneDesc('Gu_Techno'),
    new MarioKart8SceneDesc('Gu_WaterPark'),
    new MarioKart8SceneDesc('Gwii_GrumbleVolcano'),
    new MarioKart8SceneDesc('Gwii_MooMooMeadows'),
];
export const sceneGroup: SceneGroup = { id, name, sceneDescs, hidden: true };
