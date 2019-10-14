import { Color, colorNew, colorLerp, colorNewCopy, White } from '../Color';
import { lerp } from '../MathHelpers';

function colorNorm(r: number, g: number, b: number, a: number = 255.0): Color {
    return colorNew(r/255.0, g/255.0, b/255.0, a/255.0);
}

function colorSum(dst: Color, a: Color, b: Color) {
    dst.r = a.r + b.r;
    dst.g = a.g + b.g;
    dst.b = a.b + b.b;
    dst.a = a.a + b.a;
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
    poleShad: number;
    farClp: number;
    fogSt: number;
    lightGnd: number;

    cloud: Color;
    fluffyTop: Color;
    fluffyBot: Color;
    blur: Color;
    water: Color;
}

export async function parseTimeCycle(text: string) {
    const lines = text.split("\n");
    const sets = [] as ColorSet[];
    for (const s of lines) {
        const line = s.trim().toLowerCase();
        if (line === '' || line.startsWith('//')) continue;
        const row = line.split(/\s+/).map(Number);
        let [
            ambR, ambG, ambB,
            ambR_obj, ambG_obj, ambB_obj,
            ambR_bl, ambG_bl, ambB_bl,
            ambR_obj_bl, ambG_obj_bl, ambB_obj_bl,
            dirR, dirG, dirB,
            skyTopR, skyTopG, skyTopB,
            skyBotR, skyBotG, skyBotB,
            sunCoreR, sunCoreG, sunCoreB,
            sunCoronaR, sunCoronaG, sunCoronaB,
            sunSz, sprSz, sprBght,
            shad, lightShad, poleShad,
            farClp, fogSt, lightGnd,
            cloudR, cloudG, cloudB,
            fluffyTopR, fluffyTopG, fluffyTopB,
            fluffyBotR, fluffyBotG, fluffyBotB,
            blurR, blurG, blurB, blurA,
            waterR, waterG, waterB, waterA,
        ] = [] as (number | undefined)[];
        if (row.length === 40) { // III
            [
                ambR, ambG, ambB,
                dirR, dirG, dirB,
                skyTopR, skyTopG, skyTopB,
                skyBotR, skyBotG, skyBotB,

                sunCoreR, sunCoreG, sunCoreB,
                sunCoronaR, sunCoronaG, sunCoronaB,
                sunSz, sprSz, sprBght,
                shad, lightShad, poleShad,
                farClp, fogSt, lightGnd,

                cloudR, cloudG, cloudB,
                fluffyTopR, fluffyTopG, fluffyTopB,
                fluffyBotR, fluffyBotG, fluffyBotB,
                blurR, blurG, blurB, blurA,
            ] = row;
        } else if (row.length === 52) { // VC
            [
                ambR, ambG, ambB,
                ambR_obj, ambG_obj, ambB_obj,
                ambR_bl, ambG_bl, ambB_bl,
                ambR_obj_bl, ambG_obj_bl, ambB_obj_bl,
                dirR, dirG, dirB,
                skyTopR, skyTopG, skyTopB,
                skyBotR, skyBotG, skyBotB,
                sunCoreR, sunCoreG, sunCoreB,
                sunCoronaR, sunCoronaG, sunCoronaB,
                sunSz, sprSz, sprBght,
                shad, lightShad, poleShad,
                farClp, fogSt, lightGnd,
                cloudR, cloudG, cloudB,
                fluffyTopR, fluffyTopG, fluffyTopB,
                fluffyBotR, fluffyBotG, fluffyBotB,
                blurR, blurG, blurB,
                waterR, waterG, waterB, waterA,
            ] = row;
        } else {
            throw new Error('unable to parse time cycle');
        }
        const amb = colorNorm(ambR, ambG, ambB, 0);
        const dir = colorNorm(dirR, dirG, dirB);
        const skyTop = colorNorm(skyTopR, skyTopG, skyTopB);
        const skyBot = colorNorm(skyBotR, skyBotG, skyBotB);
        const sunCore = colorNorm(sunCoreR, sunCoreG, sunCoreB);
        const sunCorona = colorNorm(sunCoronaR, sunCoronaG, sunCoronaB);
        const cloud = colorNorm(cloudR, cloudG, cloudB);
        const fluffyTop = colorNorm(fluffyTopR, fluffyTopG, fluffyTopB);
        const fluffyBot = colorNorm(fluffyBotR, fluffyBotG, fluffyBotB);
        const blur = colorNorm(blurR, blurG, blurB, blurA);
        const water = colorNewCopy(White);
        if (waterR !== undefined && waterG !== undefined && waterB !== undefined && waterA !== undefined) {
            water.r = waterR / 0xFF;
            water.g = waterG / 0xFF;
            water.b = waterB / 0xFF;
            water.a = waterA / 0xFF;
        } else {
            colorSum(water, amb, dir);
        }
        sets.push({
            amb, dir, skyTop, skyBot,
            sunCore, sunCorona, sunSz, sprSz, sprBght,
            shad, lightShad, poleShad,
            farClp, fogSt, lightGnd,
            cloud, fluffyTop, fluffyBot, blur, water,
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
        poleShad: 0,
        farClp: 0,
        fogSt: 0,
        lightGnd: 0,

        cloud: colorNewCopy(White),
        fluffyTop: colorNewCopy(White),
        fluffyBot: colorNewCopy(White),
        blur: colorNewCopy(White),
        water: colorNewCopy(White),
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
    dst.poleShad = lerp(a.poleShad, b.poleShad, t);
    dst.farClp = lerp(a.farClp, b.farClp, t);
    dst.fogSt = lerp(a.fogSt, b.fogSt, t);
    dst.lightGnd = lerp(a.lightGnd, b.lightGnd, t);

    colorLerp(dst.cloud, a.cloud, b.cloud, t);
    colorLerp(dst.fluffyTop, a.fluffyTop, b.fluffyTop, t);
    colorLerp(dst.fluffyBot, a.fluffyBot, b.fluffyBot, t);
    colorLerp(dst.blur, a.blur, b.blur, t);
    colorLerp(dst.water, a.water, b.water, t);
}
