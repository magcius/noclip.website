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
        const gameFilesPath = "SuperMonkeyBall/test";
        const stageIdStr = `${leftPad(stageId.toString(), 3, "0")}`;
        const stagedefPath = `${gameFilesPath}/st${stageIdStr}/STAGE${stageIdStr}.lz`;
        const stageGmaPath = `${gameFilesPath}/st${stageIdStr}/st${stageIdStr}.gma`;
        const stageTplPath = `${gameFilesPath}/st${stageIdStr}/st${stageIdStr}.tpl`;
        const stageInfo = assertExists(STAGE_INFO_MAP.get(stageId));
        const bgFilename = stageInfo.bgInfo.fileName;
        const bgGmaPath = `${gameFilesPath}/bg/${bgFilename}.gma`;
        const bgTplPath = `${gameFilesPath}/bg/${bgFilename}.tpl`;

        const [stagedefBuf, stageGmaBuf, stageTplBuf, bgGmaBuf, bgTplBuf] = await Promise.all([
            dataFetcher.fetchData(stagedefPath),
            dataFetcher.fetchData(stageGmaPath),
            dataFetcher.fetchData(stageTplPath),
            dataFetcher.fetchData(bgGmaPath),
            dataFetcher.fetchData(bgTplPath),
        ]);

        const stagedef = parseStagedefLz(stagedefBuf);
        const stageTpl = parseAVTpl(stageTplBuf, `st${stageIdStr}`);
        const stageGma = Gma.parseGma(stageGmaBuf, stageTpl);
        const bgTpl = parseAVTpl(bgTplBuf, bgFilename);
        const bgGma = Gma.parseGma(bgGmaBuf, bgTpl);

        return { stageInfo, stagedef, stageGma, bgGma };
    }
}

const id = "supermonkeyball";
const name = "Super Monkey Ball";

const sceneDescs = [
    "Jungle",
    new SuperMonkeyBallSceneDesc(StageId.St001_Plain, "Beginner 01 - Plain"),
    new SuperMonkeyBallSceneDesc(StageId.St002_Diamond, "Beginner 02 - Diamond"),
    new SuperMonkeyBallSceneDesc(StageId.St003_Hairpin, "Beginner 03 - Hairpin"),
    new SuperMonkeyBallSceneDesc(StageId.St004_Wide_Bridge, "Beginner 04 - Wide Bridge"),
    new SuperMonkeyBallSceneDesc(StageId.St011_Bump, "Wide Bridge"),
    new SuperMonkeyBallSceneDesc(StageId.St012_Walking, "Walking"),
    new SuperMonkeyBallSceneDesc(StageId.St013_Repulse, "Repulse"),
    new SuperMonkeyBallSceneDesc(StageId.St014_Narrow_Bridge, "Narrow Bridge"),
    new SuperMonkeyBallSceneDesc(StageId.St041_Ruin, "Expert 01 - Ruin"),
    new SuperMonkeyBallSceneDesc(StageId.St042_Branch, "Expert 02 - Branch"),
    new SuperMonkeyBallSceneDesc(StageId.St043_Overturn, "Expert 03 - Overturn"),
    new SuperMonkeyBallSceneDesc(StageId.St044_Excursion, "Expert 04 - Excursion"),
    "Sunset",
    new SuperMonkeyBallSceneDesc(StageId.St005_Slopes, "Beginner 06 - Slopes"),
    new SuperMonkeyBallSceneDesc(StageId.St006_Steps, "Beginner 07 - Steps"),
    new SuperMonkeyBallSceneDesc(StageId.St007_Blocks, "Beginner 08 - Blocks"),
    new SuperMonkeyBallSceneDesc(StageId.St008_Jump_Single, "Beginner 09 - Jump Single"),
    new SuperMonkeyBallSceneDesc(StageId.St009_Exam_A, "Beginner 10 - Exam-A"),
    new SuperMonkeyBallSceneDesc(StageId.St015_Break, "Break"),
    new SuperMonkeyBallSceneDesc(StageId.St016_Curves, "Curves"),
    new SuperMonkeyBallSceneDesc(StageId.St017_Downhill, "Downhill"),
    new SuperMonkeyBallSceneDesc(StageId.St018_Blocks_Slim, "Blocks Slim"),
    "Night",
    new SuperMonkeyBallSceneDesc(StageId.St021_Choice, "Choice"),
    new SuperMonkeyBallSceneDesc(StageId.St022_Bowl, "Bowl"),
    new SuperMonkeyBallSceneDesc(StageId.St023_Jumpies, "Advanced 13 - Jumpies"),
    new SuperMonkeyBallSceneDesc(StageId.St024_Stoppers, "Stoppers"),
    new SuperMonkeyBallSceneDesc(StageId.St025_Floor_Bent, "Floor Bent"),
    new SuperMonkeyBallSceneDesc(StageId.St026_Conveyor, "Conveyor"),
    new SuperMonkeyBallSceneDesc(StageId.St027_Exam_B, "Exam-B"),
    new SuperMonkeyBallSceneDesc(StageId.St028_Chaser, "Chaser"),
    new SuperMonkeyBallSceneDesc(StageId.St029_Jump_Double, "Jump Double"),
    new SuperMonkeyBallSceneDesc(StageId.St045_Dodecagon, "Dodecagon"),
    new SuperMonkeyBallSceneDesc(StageId.St046_Exam_C, "Exam-C"),
    new SuperMonkeyBallSceneDesc(StageId.St047_Skeleton, "Skeleton"),
    new SuperMonkeyBallSceneDesc(StageId.St048_Tracks, "Tracks"),
    "Water",
    new SuperMonkeyBallSceneDesc(StageId.St031_Middle_Jam, "Middle Jam"),
    new SuperMonkeyBallSceneDesc(StageId.St032_Antlion, "Antlion"),
    new SuperMonkeyBallSceneDesc(StageId.St033_Collapse, "Collapse"),
    new SuperMonkeyBallSceneDesc(StageId.St034_Swing_Bar, "Swing Bar"),
    new SuperMonkeyBallSceneDesc(StageId.St035_Labyrinth, "Advanced 25 - Labyrinth"),
    new SuperMonkeyBallSceneDesc(StageId.St036_Spiral, "Spiral"),
    new SuperMonkeyBallSceneDesc(StageId.St037_Wavy_Jump, "Wavy Jump"),
    new SuperMonkeyBallSceneDesc(StageId.St038_Spiky, "Spiky"),
    new SuperMonkeyBallSceneDesc(StageId.St039_Unrest, "Unrest"),
    new SuperMonkeyBallSceneDesc(StageId.St040_Polar, "Polar"),
    new SuperMonkeyBallSceneDesc(StageId.St051_Downhill_Hard, "Downhill Hard"),
    new SuperMonkeyBallSceneDesc(StageId.St052_Gears, "Gears"),
    new SuperMonkeyBallSceneDesc(StageId.St053_Destruction, "Destruction"),
    new SuperMonkeyBallSceneDesc(StageId.St054_Invasion, "Invasion"),
    new SuperMonkeyBallSceneDesc(StageId.St055_Diving, "Diving"),
    new SuperMonkeyBallSceneDesc(StageId.St056_Floor_Slant, "Floor Slant"),
    new SuperMonkeyBallSceneDesc(StageId.St057_Tram, "Tram"),
    new SuperMonkeyBallSceneDesc(StageId.St058_Swing_Bar_Long, "Swing Bar Long"),
    new SuperMonkeyBallSceneDesc(StageId.St059_Paperwork, "Paper Work"),
    "Sand",
    new SuperMonkeyBallSceneDesc(StageId.St061_Twin_Attacker, "Twin Attacker"),
    new SuperMonkeyBallSceneDesc(StageId.St062_Sega_Logo, "Sega Logo"),
    new SuperMonkeyBallSceneDesc(StageId.St063_Snake, "Snake"),
    new SuperMonkeyBallSceneDesc(StageId.St064_Wind, "Wind"),
    new SuperMonkeyBallSceneDesc(StageId.St065_Windy_Slide, "Windy Slide"),
    new SuperMonkeyBallSceneDesc(StageId.St066_Fall_Down, "Fall Down"),
    new SuperMonkeyBallSceneDesc(StageId.St067_Twin_Cross, "Twin Cross"),
    new SuperMonkeyBallSceneDesc(StageId.St068_Spiral_Hard, "Spiral Hard"),
    new SuperMonkeyBallSceneDesc(StageId.St069_Conveyor_Parts, "Conveyor Parts"),
    "Ice",
    new SuperMonkeyBallSceneDesc(StageId.St071_Gaps, "Gaps"),
    new SuperMonkeyBallSceneDesc(StageId.St072_Curvature, "Curvature"),
    new SuperMonkeyBallSceneDesc(StageId.St073_Ant_Lion_Super, "Ant Lion Super"),
    new SuperMonkeyBallSceneDesc(StageId.St074_Drum, "Drum"),
    new SuperMonkeyBallSceneDesc(StageId.St075_Twist_And_Spin, "Twist And Spin"),
    new SuperMonkeyBallSceneDesc(StageId.St076_Speedy_Jam, "Speedy Jam"),
    new SuperMonkeyBallSceneDesc(StageId.St077_Quake, "Quake"),
    new SuperMonkeyBallSceneDesc(StageId.St078_Cassiopeia, "Cassiopeia"),
    new SuperMonkeyBallSceneDesc(StageId.St079_Pirates, "Pirates"),
    "Storm",
    new SuperMonkeyBallSceneDesc(StageId.St081_Bowl_Open, "Bowl Open"),
    new SuperMonkeyBallSceneDesc(StageId.St082_Checker, "Checker"),
    new SuperMonkeyBallSceneDesc(StageId.St083_Carpet, "Carpet"),
    new SuperMonkeyBallSceneDesc(StageId.St084_Ridge, "Ridge"),
    new SuperMonkeyBallSceneDesc(StageId.St085_Mixer, "Mixer"),
    new SuperMonkeyBallSceneDesc(StageId.St086_Rings, "Rings"),
    new SuperMonkeyBallSceneDesc(StageId.St087_Stairs, "Stairs"),
    new SuperMonkeyBallSceneDesc(StageId.St088_Clover, "Clover"),
    new SuperMonkeyBallSceneDesc(StageId.St089_Coffee_Cup, "Coffee Cup"),
    new SuperMonkeyBallSceneDesc(StageId.St090_Metamorphasis, "Metamorphasis"),
    "Space",
    new SuperMonkeyBallSceneDesc(StageId.St101_Blur_Bridge, "Blur Bridge"),
    new SuperMonkeyBallSceneDesc(StageId.St102_Hitter, "Hitter"),
    new SuperMonkeyBallSceneDesc(StageId.St103_Av_Logo, "AV Logo"),
    new SuperMonkeyBallSceneDesc(StageId.St104_Hard_Hitter, "Hard Hitter"),
    new SuperMonkeyBallSceneDesc(StageId.St105_Puzzle, "Puzzle"),
    new SuperMonkeyBallSceneDesc(StageId.St106_Polar_Large, "Polar Large"),
    new SuperMonkeyBallSceneDesc(StageId.St108_Ferris_Wheel, "Ferris Wheel"),
    new SuperMonkeyBallSceneDesc(StageId.St109_Factory, "Factory"),
    new SuperMonkeyBallSceneDesc(StageId.St110_Curl_Pipe, "Curl Pipe"),
    new SuperMonkeyBallSceneDesc(StageId.St111_Magic_Hand, "Magic Hand"),
    new SuperMonkeyBallSceneDesc(StageId.St112_Sanctuary, "Sanctuary"),
    new SuperMonkeyBallSceneDesc(StageId.St113_Daa_Loo_Maa, "Daa Loo Maa"),
    "Bonus",
    new SuperMonkeyBallSceneDesc(StageId.St091_Bonus_Basic, "Bonus Basic"),
    // new SuperMonkeyBallSceneDesc(StageId.St092_Bonus_Wave, "Bonus Wave"), // TODO(complexplane)
    new SuperMonkeyBallSceneDesc(StageId.St093_Bonus_Grid, "Bonus Grid"),
    new SuperMonkeyBallSceneDesc(StageId.St094_Bonus_Bumpy, "Bonus Bumpy"),
    new SuperMonkeyBallSceneDesc(StageId.St095_Bonus_Hunting, "Bonus Hunting"),
    "Master",
    new SuperMonkeyBallSceneDesc(StageId.St121_Wave_Master, "Wave Master"),
    new SuperMonkeyBallSceneDesc(StageId.St122_Fan_Master, "Fan Master"),
    new SuperMonkeyBallSceneDesc(StageId.St123_Stamina_Master, "Stamina Master"),
    new SuperMonkeyBallSceneDesc(StageId.St124_Spring_Master, "Spring Master"),
    new SuperMonkeyBallSceneDesc(StageId.St125_Dance_Master, "Dance Master"),
    new SuperMonkeyBallSceneDesc(StageId.St126_Roll_Master, "Roll Master"),
    new SuperMonkeyBallSceneDesc(StageId.St127_Edge_Master, "Edge Master"),
    new SuperMonkeyBallSceneDesc(StageId.St128_Dodge_Master, "Dodge Master"),
    new SuperMonkeyBallSceneDesc(StageId.St129_Bridge_Master, "Bridge Master"),
    new SuperMonkeyBallSceneDesc(StageId.St130_Monkey_Master, "Monkey Master"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
