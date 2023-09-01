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

//Gross but I implemented this too late to have a cleaner implementation not relying on globals
export class gDQ8SINFO {
    //Lighting
    static currentLightSet: MAP.LightSet | null;
    static lightSets: MAP.LightSet[];
    //Day periods 
    static currentDayPeriodFlags: number;
    static currentNPCDayPeriod: ENPCDayPeriod;
    //Game hour
    static currentHour: number;
    //User hour
    static currentUserHour: number;
    //Progress
    static currentGameProgress: number;
    //Vcol
    static bUseVColors: boolean;
}

export function InitSceneInfo() {
    gDQ8SINFO.currentLightSet = null;
    gDQ8SINFO.lightSets = [];
    gDQ8SINFO.currentDayPeriodFlags = 1;
    gDQ8SINFO.currentNPCDayPeriod = ENPCDayPeriod.DAY;
    gDQ8SINFO.currentHour = 6.5;
    gDQ8SINFO.currentGameProgress = 0;
    gDQ8SINFO.bUseVColors = true;
}

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

export function UpdateSceneInfo(viewerInput: Viewer.ViewerRenderInput, bNeedNPCPeriodUpdate: boolean, bNeedDayPeriodUpdate: boolean) {
    //Time update
    if (gDQ8SINFO.currentUserHour < 0) {
        gDQ8SINFO.currentHour += viewerInput.deltaTime / 2000;
        while (gDQ8SINFO.currentHour > 24)
            gDQ8SINFO.currentHour -= 24;
    }
    else {
        gDQ8SINFO.currentHour = gDQ8SINFO.currentUserHour;
    }

    //Light set update    
    if (gDQ8SINFO.lightSets.length) {
        let hour = gDQ8SINFO.currentHour - 9; //Not a hack, done like this ingame. Matches the day period approach too.
        if (hour < 0)
            hour += 24;
        gDQ8SINFO.currentLightSet = gDQ8SINFO.lightSets[Math.floor(hour / (24 / gDQ8SINFO.lightSets.length)) % gDQ8SINFO.lightSets.length];
    }

    //Day schedule update
    const nextDayPeriod = getDayPeriodFlags(gDQ8SINFO.currentHour);
    if (nextDayPeriod !== gDQ8SINFO.currentDayPeriodFlags) {
        gDQ8SINFO.currentDayPeriodFlags = nextDayPeriod;
        bNeedDayPeriodUpdate = true;
    }

    //NPC schedule update
    const nextNPCDayPeriod = getNPCDayPeriod(gDQ8SINFO.currentHour);
    if (nextNPCDayPeriod !== gDQ8SINFO.currentNPCDayPeriod) {
        gDQ8SINFO.currentNPCDayPeriod = nextNPCDayPeriod;
        bNeedNPCPeriodUpdate = true;
    }

}