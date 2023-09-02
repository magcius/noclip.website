import * as Viewer from '../viewer.js';
import * as MAP from './map.js';

export enum EDayPeriod {
    DAY = 0x0, //9->17
    EVENING = 0x1, //17->19
    NIGHT = 0x2, //19->6
    MORNING = 0x3//6->9
}

export enum ENPCDayPeriod {
    DAY = 0x0, //6->18
    EARLYNIGHT = 0x1, //18->1
    LATENIGHT = 0x2 //1->6
}

export class SceneInfo {
    //Lighting
    public currentLightSet: MAP.LightSet | null;
    public lightSets: MAP.LightSet[];
    //Day periods 
    public currentDayPeriodFlags: number;
    public currentNPCDayPeriod: ENPCDayPeriod;
    //Game hour
    public currentHour: number;
    //User hour
    public currentUserHour: number;
    //Progress
    public currentGameProgress: number;
    //Vcol
    public bUseVColors: boolean;

    //Game progress breakdown (used by the scripts)
    public stbMainProgress: number;
    public stbSubProgress: number;
    public stbEventFlags: number;

    public reset() {
        this.currentLightSet = null;
        this.lightSets = [];
        this.currentDayPeriodFlags = 1;
        this.currentNPCDayPeriod = ENPCDayPeriod.DAY;
        this.currentHour = 6.5;
        this.currentGameProgress = 0;
        this.bUseVColors = true;
        this.stbMainProgress = 0x1;
        this.stbSubProgress = 0x0;
        this.stbEventFlags = 0x0;
   }
}

export const gDQ8SINFO = new SceneInfo();

function getDayPeriodFlags(h: number): number {
    if (6 < h && h < 9)
        return 1;
    if (9 < h && h < 17)
        return 2;
    if (17 < h && h < 19)
        return 4;
    return 8;
}

function getNPCDayPeriod(h: number): ENPCDayPeriod {
    if (1 < h && h < 6)
        return ENPCDayPeriod.LATENIGHT;
    if (6 < h && h < 18)
        return ENPCDayPeriod.DAY;
    return ENPCDayPeriod.EARLYNIGHT;
}

export function UpdateSceneInfo(sceneInfo: SceneInfo, deltaTime: number): void {
    //Time update
    if (sceneInfo.currentUserHour < 0) {
        sceneInfo.currentHour += deltaTime / 2000;
        while (sceneInfo.currentHour > 24)
            sceneInfo.currentHour -= 24;
    } else {
        sceneInfo.currentHour = sceneInfo.currentUserHour;
    }

    //Light set update    
    if (sceneInfo.lightSets.length) {
        let hour = sceneInfo.currentHour - 9; //Not a hack, done like this ingame. Matches the day period approach too.
        if (hour < 0)
            hour += 24;
        sceneInfo.currentLightSet = sceneInfo.lightSets[Math.floor(hour / (24 / sceneInfo.lightSets.length)) % sceneInfo.lightSets.length];
    }

    //Day schedule update
    sceneInfo.currentDayPeriodFlags = getDayPeriodFlags(sceneInfo.currentHour);

    //NPC schedule update
    sceneInfo.currentNPCDayPeriod = getNPCDayPeriod(sceneInfo.currentHour);
}
