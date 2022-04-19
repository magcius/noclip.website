import { DataFetcher } from "../DataFetcher";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext } from "../SceneBase";
import * as Viewer from "../viewer";
import { parseStagedefLz } from "./Stagedef";
import { Renderer } from "./Render";
import { BG_INFO_MAP, StageId, STAGE_INFO_MAP } from "./StageInfo";
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
    new SuperMonkeyBallSceneDesc(StageId.St004_WideBridge, "Beginner 04 - Wide Bridge"),
    "Sunset",
    new SuperMonkeyBallSceneDesc(StageId.St005_Slopes, "Beginner 06 - Slopes"),
    new SuperMonkeyBallSceneDesc(StageId.St006_Steps, "Beginner 07 - Steps"),
    new SuperMonkeyBallSceneDesc(StageId.St007_Blocks, "Beginner 08 - Blocks"),
    new SuperMonkeyBallSceneDesc(StageId.St008_JumpSingle, "Beginner 09 - Jump Single"),
    new SuperMonkeyBallSceneDesc(StageId.St009_ExamA, "Beginner 10 - Exam-A"),
    "Night",
    new SuperMonkeyBallSceneDesc(StageId.St023_Jumpies, "Advanced 13 - Jumpies"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
