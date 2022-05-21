import { DataFetcher } from "../DataFetcher";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext } from "../SceneBase";
import * as Viewer from "../viewer";
import { parseStagedefLz } from "./Stagedef";
import { Renderer } from "./Render";
import { StageId, STAGE_INFO_MAP } from "./StageInfo";
import * as Gma from "./Gma";
import { parseAVTpl } from "./AVTpl";
import { assertExists, leftPad } from "../util";
import { StageData } from "./World";
import { decompressLZ } from "./AVLZ";

class SuperMonkeyBallSceneDesc implements Viewer.SceneDesc {
    public id: string;
    public name: string;
    private stageId: StageId;

    constructor(stageId: StageId, name: string) {
        this.stageId = stageId;
        this.id = name;
        this.name = name;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const stageData = await this.fetchStage(context.dataFetcher, this.stageId);
        return new Renderer(device, stageData);
    }

    private async fetchStage(dataFetcher: DataFetcher, stageId: StageId): Promise<StageData> {
        const gameFilesPath = "SuperMonkeyBall1/test";
        const stageIdStr = `${leftPad(stageId.toString(), 3, "0")}`;
        const stagedefPath = `${gameFilesPath}/st${stageIdStr}/STAGE${stageIdStr}.lz`;
        const stageGmaPath = `${gameFilesPath}/st${stageIdStr}/st${stageIdStr}.gma`;
        const stageTplPath = `${gameFilesPath}/st${stageIdStr}/st${stageIdStr}.tpl`;
        const stageInfo = assertExists(STAGE_INFO_MAP.get(stageId));

        const bgFilename = stageInfo.bgInfo.fileName;
        const bgGmaPath = `${gameFilesPath}/bg/${bgFilename}.gma`;
        const bgTplPath = `${gameFilesPath}/bg/${bgFilename}.tpl`;

        const commonGmaPath = `${gameFilesPath}/init/common.gma.lz`;
        const commonTplPath = `${gameFilesPath}/init/common.tpl.lz`;

        const [stagedefBuf, stageGmaBuf, stageTplBuf, bgGmaBuf, bgTplBuf, commonGmaBuf, commonTplBuf] =
            await Promise.all([
                dataFetcher.fetchData(stagedefPath),
                dataFetcher.fetchData(stageGmaPath),
                dataFetcher.fetchData(stageTplPath),
                dataFetcher.fetchData(bgGmaPath),
                dataFetcher.fetchData(bgTplPath),
                dataFetcher.fetchData(commonGmaPath),
                dataFetcher.fetchData(commonTplPath),
            ]);

        const stagedef = parseStagedefLz(stagedefBuf);
        const stageTpl = parseAVTpl(stageTplBuf, `st${stageIdStr}`);
        const stageGma = Gma.parseGma(stageGmaBuf, stageTpl);
        const bgTpl = parseAVTpl(bgTplBuf, bgFilename);
        const bgGma = Gma.parseGma(bgGmaBuf, bgTpl);
        const commonTpl = parseAVTpl(decompressLZ(commonTplBuf), "common");
        const commonGma = Gma.parseGma(decompressLZ(commonGmaBuf), commonTpl);

        return { stageInfo, stagedef, stageGma, bgGma, commonGma };
    }
}

const id = "supermonkeyball";
const name = "Super Monkey Ball";

const sceneDescs = [
    "Jungle",
    new SuperMonkeyBallSceneDesc(StageId.St001_Plain, "Beginner 1 - Plain"),
    new SuperMonkeyBallSceneDesc(StageId.St002_Diamond, "Beginner 2 - Diamond"),
    new SuperMonkeyBallSceneDesc(StageId.St003_Hairpin, "Beginner 3 - Hairpin"),
    new SuperMonkeyBallSceneDesc(StageId.St004_Wide_Bridge, "Beginner 4 - Wide Bridge"),
    new SuperMonkeyBallSceneDesc(StageId.St011_Bump, "Advanced 1 - Bump"),
    new SuperMonkeyBallSceneDesc(StageId.St012_Walking, "Advanced 2 - Walking"),
    new SuperMonkeyBallSceneDesc(StageId.St013_Repulse, "Advanced 3 - Repulse"),
    new SuperMonkeyBallSceneDesc(StageId.St014_Narrow_Bridge, "Advanced 4 - Narrow Bridge"),
    new SuperMonkeyBallSceneDesc(StageId.St041_Ruin, "Expert 1 - Ruin"),
    new SuperMonkeyBallSceneDesc(StageId.St042_Branch, "Expert 2 - Branch"),
    new SuperMonkeyBallSceneDesc(StageId.St043_Overturn, "Expert 3 - Overturn"),
    new SuperMonkeyBallSceneDesc(StageId.St044_Excursion, "Expert 4 - Excursion"),
    "Sunset",
    new SuperMonkeyBallSceneDesc(StageId.St005_Slopes, "Beginner 6 - Slopes"),
    new SuperMonkeyBallSceneDesc(StageId.St006_Steps, "Beginner 7 - Steps"),
    new SuperMonkeyBallSceneDesc(StageId.St007_Blocks, "Beginner 8 - Blocks"),
    new SuperMonkeyBallSceneDesc(StageId.St008_Jump_Single, "Beginner 9 - Jump Single"),
    new SuperMonkeyBallSceneDesc(StageId.St009_Exam_A, "Beginner 10 - Exam-A"),
    new SuperMonkeyBallSceneDesc(StageId.St015_Break, "Advanced 6 - Break"),
    new SuperMonkeyBallSceneDesc(StageId.St016_Curves, "Advanced 7 - Curves"),
    new SuperMonkeyBallSceneDesc(StageId.St017_Downhill, "Advanced 8 - Downhill"),
    new SuperMonkeyBallSceneDesc(StageId.St018_Blocks_Slim, "Advanced 9 - Blocks Slim"),
    "Night",
    new SuperMonkeyBallSceneDesc(StageId.St021_Choice, "Advanced 11 - Choice"),
    new SuperMonkeyBallSceneDesc(StageId.St022_Bowl, "Advanced 12 - Bowl"),
    new SuperMonkeyBallSceneDesc(StageId.St023_Jumpies, "Advanced 13 - Jumpies"),
    new SuperMonkeyBallSceneDesc(StageId.St024_Stoppers, "Advanced 14 - Stoppers"),
    new SuperMonkeyBallSceneDesc(StageId.St025_Floor_Bent, "Advanced 15 - Floor Bent"),
    new SuperMonkeyBallSceneDesc(StageId.St026_Conveyor, "Advanced 16 - Conveyor"),
    new SuperMonkeyBallSceneDesc(StageId.St027_Exam_B, "Advanced 17 - Exam-B"),
    new SuperMonkeyBallSceneDesc(StageId.St028_Chaser, "Advanced 18 - Chaser"),
    new SuperMonkeyBallSceneDesc(StageId.St029_Jump_Double, "Advanced 19 - Jump Double"),
    new SuperMonkeyBallSceneDesc(StageId.St045_Dodecagon, "Expert 6 - Dodecagon"),
    new SuperMonkeyBallSceneDesc(StageId.St046_Exam_C, "Expert 7 - Exam-C"),
    new SuperMonkeyBallSceneDesc(StageId.St047_Skeleton, "Expert 8 - Skeleton"),
    new SuperMonkeyBallSceneDesc(StageId.St048_Tracks, "Expert 9 - Tracks"),
    "Water",
    new SuperMonkeyBallSceneDesc(StageId.St031_Middle_Jam, "Advanced 21 - Middle Jam"),
    new SuperMonkeyBallSceneDesc(StageId.St032_Antlion, "Advanced 22 - Antlion"),
    new SuperMonkeyBallSceneDesc(StageId.St033_Collapse, "Advanced 23 - Collapse"),
    new SuperMonkeyBallSceneDesc(StageId.St034_Swing_Bar, "Advanced 24 - Swing Bar"),
    new SuperMonkeyBallSceneDesc(StageId.St035_Labyrinth, "Advanced 25 - Labyrinth"),
    new SuperMonkeyBallSceneDesc(StageId.St036_Spiral, "Advanced 26 - Spiral"),
    new SuperMonkeyBallSceneDesc(StageId.St037_Wavy_Jump, "Advanced 27 - Wavy Jump"),
    new SuperMonkeyBallSceneDesc(StageId.St038_Spiky, "Advanced 28 - Spiky"),
    new SuperMonkeyBallSceneDesc(StageId.St039_Unrest, "Advanced 29 - Unrest"),
    new SuperMonkeyBallSceneDesc(StageId.St040_Polar, "Advanced 30 - Polar"),
    new SuperMonkeyBallSceneDesc(StageId.St051_Downhill_Hard, "Expert 11 - Downhill Hard"),
    new SuperMonkeyBallSceneDesc(StageId.St052_Gears, "Expert 12 - Gears"),
    new SuperMonkeyBallSceneDesc(StageId.St053_Destruction, "Expert 13 - Destruction"),
    new SuperMonkeyBallSceneDesc(StageId.St054_Invasion, "Expert 14 - Invasion"),
    new SuperMonkeyBallSceneDesc(StageId.St055_Diving, "Expert 15 - Diving"),
    new SuperMonkeyBallSceneDesc(StageId.St056_Floor_Slant, "Expert 16 - Floor Slant"),
    new SuperMonkeyBallSceneDesc(StageId.St057_Tram, "Expert 17 - Tram"),
    new SuperMonkeyBallSceneDesc(StageId.St058_Swing_Bar_Long, "Expert 18 - Swing Bar Long"),
    new SuperMonkeyBallSceneDesc(StageId.St059_Paperwork, "Expert 19 - Paper Work"),
    "Sand",
    new SuperMonkeyBallSceneDesc(StageId.St061_Twin_Attacker, "Expert 21 - Twin Attacker"),
    new SuperMonkeyBallSceneDesc(StageId.St062_Sega_Logo, "Expert 22 - Sega Logo"),
    new SuperMonkeyBallSceneDesc(StageId.St063_Snake, "Expert 23 - Snake"),
    new SuperMonkeyBallSceneDesc(StageId.St064_Wind, "Expert 24 - Wind"),
    new SuperMonkeyBallSceneDesc(StageId.St065_Windy_Slide, "Expert 25 - Windy Slide"),
    new SuperMonkeyBallSceneDesc(StageId.St066_Fall_Down, "Expert 26 - Fall Down"),
    new SuperMonkeyBallSceneDesc(StageId.St067_Twin_Cross, "Expert 27 - Twin Cross"),
    new SuperMonkeyBallSceneDesc(StageId.St068_Spiral_Hard, "Expert 28 - Spiral Hard"),
    new SuperMonkeyBallSceneDesc(StageId.St069_Conveyor_Parts, "Expert 29 - Conveyor Parts"),
    "Ice",
    new SuperMonkeyBallSceneDesc(StageId.St071_Gaps, "Expert 31 - Gaps"),
    new SuperMonkeyBallSceneDesc(StageId.St072_Curvature, "Expert 32 - Curvature"),
    new SuperMonkeyBallSceneDesc(StageId.St073_Ant_Lion_Super, "Expert 33 - Ant Lion Super"),
    new SuperMonkeyBallSceneDesc(StageId.St074_Drum, "Expert 34 - Drum"),
    new SuperMonkeyBallSceneDesc(StageId.St075_Twist_And_Spin, "Expert 35 - Twist And Spin"),
    new SuperMonkeyBallSceneDesc(StageId.St076_Speedy_Jam, "Expert 36 - Speedy Jam"),
    new SuperMonkeyBallSceneDesc(StageId.St077_Quake, "Expert 37 - Quake"),
    new SuperMonkeyBallSceneDesc(StageId.St078_Cassiopeia, "Expert 38 - Cassiopeia"),
    new SuperMonkeyBallSceneDesc(StageId.St079_Pirates, "Expert 39 - Pirates"),
    "Storm",
    new SuperMonkeyBallSceneDesc(StageId.St081_Bowl_Open, "Expert 41 - Bowl Open"),
    new SuperMonkeyBallSceneDesc(StageId.St082_Checker, "Expert 42 - Checker"),
    new SuperMonkeyBallSceneDesc(StageId.St083_Carpet, "Expert 43 - Carpet"),
    new SuperMonkeyBallSceneDesc(StageId.St084_Ridge, "Expert 44 - Ridge"),
    new SuperMonkeyBallSceneDesc(StageId.St085_Mixer, "Expert 45 - Mixer"),
    new SuperMonkeyBallSceneDesc(StageId.St086_Rings, "Expert 46 - Rings"),
    new SuperMonkeyBallSceneDesc(StageId.St087_Stairs, "Expert 47 - Stairs"),
    new SuperMonkeyBallSceneDesc(StageId.St088_Clover, "Expert 48 - Clover"),
    new SuperMonkeyBallSceneDesc(StageId.St089_Coffee_Cup, "Expert 49 - Coffee Cup"),
    new SuperMonkeyBallSceneDesc(StageId.St090_Metamorphasis, "Expert 50 - Metamorphasis"),
    "Space",
    new SuperMonkeyBallSceneDesc(StageId.St101_Blur_Bridge, "BX1/AX1/EX1 - Blur Bridge"),
    new SuperMonkeyBallSceneDesc(StageId.St102_Hitter, "BX2 - Hitter"),
    new SuperMonkeyBallSceneDesc(StageId.St103_Av_Logo, "BX3/AX4/EX8 - AV Logo"),
    new SuperMonkeyBallSceneDesc(StageId.St104_Hard_Hitter, "AX2/EX2 - Hard Hitter"),
    new SuperMonkeyBallSceneDesc(StageId.St105_Puzzle, "AX3 - Puzzle"),
    new SuperMonkeyBallSceneDesc(StageId.St106_Polar_Large, "AX5 - Polar Large"),
    new SuperMonkeyBallSceneDesc(StageId.St108_Ferris_Wheel, "EX4 - Ferris Wheel"),
    new SuperMonkeyBallSceneDesc(StageId.St109_Factory, "EX5 - Factory"),
    new SuperMonkeyBallSceneDesc(StageId.St110_Curl_Pipe, "EX6 - Curl Pipe"),
    new SuperMonkeyBallSceneDesc(StageId.St111_Magic_Hand, "EX7 - Magic Hand"),
    new SuperMonkeyBallSceneDesc(StageId.St112_Sanctuary, "EX9 - Sanctuary"),
    new SuperMonkeyBallSceneDesc(StageId.St113_Daa_Loo_Maa, "EX10 - Daa Loo Maa"),
    "Bonus",
    new SuperMonkeyBallSceneDesc(StageId.St091_Bonus_Basic, "B5/A5/E5 - Bonus Basic"),
    new SuperMonkeyBallSceneDesc(StageId.St092_Bonus_Wave, "A10/E10 - Bonus Wave"),
    // new SuperMonkeyBallSceneDesc(StageId.St092_Bonus_Wave, "Bonus Wave"), // TODO(complexplane)
    new SuperMonkeyBallSceneDesc(StageId.St093_Bonus_Grid, "E20 - Bonus Grid"),
    new SuperMonkeyBallSceneDesc(StageId.St094_Bonus_Bumpy, "E30 - Bonus Bumpy"),
    new SuperMonkeyBallSceneDesc(StageId.St095_Bonus_Hunting, "E40 - Bonus Hunting"),
    "Master",
    new SuperMonkeyBallSceneDesc(StageId.St121_Wave_Master, "Master 1 - Wave Master"),
    new SuperMonkeyBallSceneDesc(StageId.St122_Fan_Master, "Master 2 - Fan Master"),
    new SuperMonkeyBallSceneDesc(StageId.St123_Stamina_Master, "Master 3 - Stamina Master"),
    new SuperMonkeyBallSceneDesc(StageId.St124_Spring_Master, "Master 4 - Spring Master"),
    new SuperMonkeyBallSceneDesc(StageId.St125_Dance_Master, "Master 5 - Dance Master"),
    new SuperMonkeyBallSceneDesc(StageId.St126_Roll_Master, "Master 6 - Roll Master"),
    new SuperMonkeyBallSceneDesc(StageId.St127_Edge_Master, "Master 7 - Edge Master"),
    new SuperMonkeyBallSceneDesc(StageId.St128_Dodge_Master, "Master 8 - Dodge Master"),
    new SuperMonkeyBallSceneDesc(StageId.St129_Bridge_Master, "Master 9 - Bridge Master"),
    new SuperMonkeyBallSceneDesc(StageId.St130_Monkey_Master, "Master 10 - Monkey Master"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
