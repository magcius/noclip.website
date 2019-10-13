import { Color, colorNew, colorLerp, colorNewCopy, White } from '../Color';
import { lerp } from '../MathHelpers';

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

export function emptyColorSet(): ColorSet {
    return {
        amb: colorNewCopy(White),
        dir: colorNewCopy(White),
        skyTop: colorNewCopy(White),
        skyBot: colorNewCopy(White),

        sunCore: colorNewCopy(White),
        sunCorona: colorNewCopy(White),
        sunSz: 0,
        sprSz: 0,
        sprBght: 0,
        shad: 0,
        lightShad: 0,
        treeShad: 0,
        farClp: 0,
        fogSt: 0,
        lightGnd: 0,

        cloud: colorNewCopy(White),
        fluffyTop: colorNewCopy(White),
        fluffyBot: colorNewCopy(White),
        blur: colorNewCopy(White),
    };
}

export function lerpColorSet(dst: ColorSet, a: ColorSet, b: ColorSet, t: number) {
    colorLerp(dst.amb, a.amb, b.amb, t);
    colorLerp(dst.dir, a.dir, b.dir, t);
    colorLerp(dst.skyTop, a.skyTop, b.skyTop, t);
    colorLerp(dst.skyBot, a.skyBot, b.skyBot, t);

    colorLerp(dst.sunCore, a.sunCore, b.sunCore, t);
    colorLerp(dst.sunCorona, a.sunCorona, b.sunCorona, t);

    dst.sunSz = lerp(a.sunSz, b.sunSz, t);
    dst.sprSz = lerp(a.sprSz, b.sprSz, t);
    dst.sprBght = lerp(a.sprBght, b.sprBght, t);
    dst.shad = lerp(a.shad, b.shad, t);
    dst.lightShad = lerp(a.lightShad, b.lightShad, t);
    dst.treeShad = lerp(a.treeShad, b.treeShad, t);
    dst.farClp = lerp(a.farClp, b.farClp, t);
    dst.fogSt = lerp(a.fogSt, b.fogSt, t);
    dst.lightGnd = lerp(a.lightGnd, b.lightGnd, t);

    colorLerp(dst.cloud, a.cloud, b.cloud, t);
    colorLerp(dst.fluffyTop, a.fluffyTop, b.fluffyTop, t);
    colorLerp(dst.fluffyBot, a.fluffyBot, b.fluffyBot, t);
    colorLerp(dst.blur, a.blur, b.blur, t);
}
