import { DataFetcher } from "../DataFetcher";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext } from "../SceneBase";
import * as Viewer from "../viewer";
import { parseStagedefLz } from "./ParseStagedef";
import { Renderer } from "./Renderer";
import { BG_TO_FILENAME_MAP, StageId, STAGE_TO_BG_MAP } from "./StageInfo";
import * as Gcmf from "./Gcmf";
import { parseAVTpl } from "./AVTpl";
import { leftPad } from "../util";
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
        const stageIdStr = `st${leftPad(stageId.toString(), 3, "0")}`;
        const stagedefPath = `${gameFilesPath}/${stageIdStr}/STAGE${stageIdStr}.lz`;
        const stageGmaPath = `${gameFilesPath}/${stageIdStr}/${stageIdStr}.gma`;
        const stageTplPath = `${gameFilesPath}/${stageIdStr}/${stageIdStr}.tpl`;
        const bgFilename = BG_TO_FILENAME_MAP[STAGE_TO_BG_MAP[stageId]];
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
        const stageGma = Gcmf.parseGma(stageGmaBuf);
        const stageTpl = parseAVTpl(stageTplBuf, stageIdStr);
        const bgGma = Gcmf.parseGma(bgGmaBuf);
        const bgTpl = parseAVTpl(bgTplBuf, bgFilename);

        return { stagedef, stageGma, stageTpl, bgGma, bgTpl };
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
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
