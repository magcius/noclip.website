import { Color, colorNew } from '../Color';

function colorNorm(r: number, g: number, b: number, a: number = 255.0): Color {
    return colorNew(r/255.0, g/255.0, b/255.0, a/255.0);
}

export interface ColorSet {
    amb: Color;
    dir: Color;
    skyTop: Color;
    skyBot: Color;

    sunCore: Color;
    sunCorona: Color;
    sunSz: number;
    sprSz: number;
    sprBght: number;
    shad: number;
    lightShad: number;
    treeShad: number;
    farClp: number;
    fogSt: number;
    lightGnd: number;

    cloud: Color;
    fluffyTop: Color;
    fluffyBot: Color;
    blur: Color;
}

export async function parseTimeCycle(text: string) {
    const lines = text.split("\n");
    const sets = [] as ColorSet[];
    for (const s of lines) {
        const line = s.trim().toLowerCase();
        if (line === '' || line.startsWith('//')) continue;
        const [
            ambR, ambG, ambB,
            dirR, dirG, dirB,
            skyTopR, skyTopG, skyTopB,
            skyBotR, skyBotG, skyBotB,

            sunCoreR, sunCoreG, sunCoreB,
            sunCoronaR, sunCoronaG, sunCoronaB,
            sunSz, sprSz, sprBght,
            shad, lightShad, treeShad,
            farClp, fogSt, lightGnd,

            cloudR, cloudG, cloudB,
            fluffyTopR, fluffyTopG, fluffyTopB,
            fluffyBotR, fluffyBotG, fluffyBotB,
            blurR, blurG, blurB, blurA
        ] = line.split(/\s+/).map(Number);
        sets.push({
            amb: colorNorm(ambR, ambG, ambB),
            dir: colorNorm(dirR, dirG, dirB),
            skyTop: colorNorm(skyTopR, skyTopG, skyTopB),
            skyBot: colorNorm(skyBotR, skyBotG, skyBotB),

            sunCore: colorNorm(sunCoreR, sunCoreG, sunCoreB),
            sunCorona: colorNorm(sunCoronaR, sunCoronaG, sunCoronaB),
            sunSz, sprSz, sprBght,
            shad, lightShad, treeShad,
            farClp, fogSt, lightGnd,

            cloud: colorNorm(cloudR, cloudG, cloudB),
            fluffyTop: colorNorm(fluffyTopR, fluffyTopG, fluffyTopB),
            fluffyBot: colorNorm(fluffyBotR, fluffyBotG, fluffyBotB),
            blur: colorNorm(blurR, blurG, blurB, blurA)
        });
    }
    return sets;
}
