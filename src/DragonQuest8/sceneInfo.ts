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

export class SceneInfo {
    //Lighting
    public currentLightSet: MAP.LightSet | null = null;
    public lightSets: MAP.LightSet[] = [];
    //Day periods 
    public currentDayPeriodFlags: number = 1;
    public currentNPCDayPeriod: ENPCDayPeriod = ENPCDayPeriod.DAY;
    //Game hour
    public currentHour: number = 6.5;
    //User hour
    public currentUserHour: number = 6.5;
    //Progress
    public currentGameProgress: number = 0;

    //Game progress breakdown (used by the scripts)
    public stbMainProgress: number = 1;
    public stbSubProgress: number = 0;
    public stbEventFlags: number = 0;

    public update(deltaTime: number): void {
        //Time update
        if (this.currentUserHour < 0) {
            this.currentHour += deltaTime / 2000;
            while (this.currentHour > 24)
                this.currentHour -= 24;
        } else {
            this.currentHour = this.currentUserHour;
        }

        //Light set update    
        if (this.lightSets.length) {
            let hour = this.currentHour - 9; //Not a hack, done like this ingame. Matches the day period approach too.
            if (hour < 0)
                hour += 24;
            this.currentLightSet = this.lightSets[Math.floor(hour / (24 / this.lightSets.length)) % this.lightSets.length];
        }

        //Day schedule update
        this.currentDayPeriodFlags = getDayPeriodFlags(this.currentHour);

        //NPC schedule update
        this.currentNPCDayPeriod = getNPCDayPeriod(this.currentHour);
    }
}
